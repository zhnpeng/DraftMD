import { expect, test } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { launchDraftMD } from '../helpers/electron-app'

test('opens a temporary Markdown document and edits without a model', async () => {
  const app = await launchDraftMD({
    prepare: (directory) => writeFile(join(directory, 'foundation.md'), '# Foundation\n\nInitial text\n', 'utf8'),
    documentName: 'foundation.md',
  })

  try {
    expect(await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'))).toBe(app.userDataPath)
    const page = await app.windowMatching(async (candidate) => {
      const title = await candidate.$('#file-title')
      return title ? await title.textContent() === 'foundation.md' : false
    })
    await expect(page).toHaveTitle(/DraftMD/)
    await expect(page.locator('#file-title')).toHaveText('foundation.md')
    await expect(page.locator('#editor')).toBeVisible()
    await expect(page.locator('#source-toggle-btn')).toHaveAccessibleName(/Markdown|源码/)
    await expect(page.locator('#file-toggle-btn')).toBeVisible()

    const editor = page.locator('#editor .ProseMirror')
    await expect(editor).toContainText('Initial text')
    await editor.click()
    await page.keyboard.press('ControlOrMeta+End')
    await page.keyboard.type(' Edited locally')
    await expect(editor).toContainText('Edited locally')
  } finally {
    await app.cleanup()
  }
})


test('document replacement resets prior history and keeps new edits undoable', async () => {
  const app = await launchDraftMD({
    prepare: async (directory) => {
      await writeFile(join(directory, 'a.md'), '# Document A\n', 'utf8')
      await writeFile(join(directory, 'b.md'), '# Document B\n', 'utf8')
    },
    documentName: 'a.md',
  })

  try {
    const page = await app.windowMatching(async (candidate) =>
      await candidate.locator('#file-title').textContent().catch(() => '') === 'a.md')
    const editor = page.locator('#editor .ProseMirror')
    await editor.click()
    await page.keyboard.press('ControlOrMeta+End')
    await page.keyboard.type(' user edit')
    await page.waitForTimeout(1_200)
    await page.evaluate((path) => window.draftmd.openSibling(path), join(app.userDataPath, 'b.md'))
    await expect(page.locator('#file-title')).toHaveText('b.md')
    await expect(editor).toContainText('Document B')

    await editor.click()
    await page.keyboard.press('ControlOrMeta+z')
    await expect(editor).toContainText('Document B')
    await expect(editor).not.toContainText('Document A')
    await page.waitForTimeout(1_200)
    expect(await readFile(join(app.userDataPath, 'b.md'), 'utf8')).toBe('# Document B\n')

    await page.keyboard.press('ControlOrMeta+End')
    await page.keyboard.type(' new edit')
    await expect(editor).toContainText('new edit')
    await page.keyboard.press('ControlOrMeta+z')
    await expect(editor).not.toContainText('new edit')
    await expect(editor).toContainText('Document B')
  } finally {
    await app.cleanup()
  }
})

test('renders inline and block LaTeX with distinct layout semantics', async () => {
  const app = await launchDraftMD({
    prepare: (directory) => writeFile(
      join(directory, 'math.md'),
      'Inline $E=mc^2$.\n\n$$\na^2+b^2=c^2\n$$\n',
      'utf8',
    ),
    documentName: 'math.md',
  })

  try {
    const page = await app.windowMatching(async (candidate) =>
      await candidate.locator('#file-title').textContent().catch(() => '') === 'math.md')
    const inline = page.locator('[data-type="math_inline"]')
    const block = page.locator('[data-type="math_block"]')
    await expect(inline.locator('.katex')).toBeVisible()
    await expect(block.locator('.katex')).toBeVisible()
    await expect(inline).toHaveCSS('display', 'inline')
    await expect(block).toHaveCSS('text-align', 'center')
  } finally {
    await app.cleanup()
  }
})
