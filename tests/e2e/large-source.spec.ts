import { expect, test } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { launchDraftMD } from '../helpers/electron-app'

test('edits, searches, undoes and saves a complete large Unicode document', async () => {
  test.setTimeout(90_000)
  const content = '# Large\n\n' + '文档 🙂 preserved content\n'.repeat(100_000) + '\nUNIQUE_END\n'
  const app = await launchDraftMD({ locale: 'en', documentName: 'large.md', prepare: dir => writeFile(join(dir, 'large.md'), content) })
  try {
    const page = await app.windowMatching(async candidate => await candidate.locator('#file-title').textContent().catch(() => '') === 'large.md')
    const source = page.locator('#large-source-editor .cm-content')
    await expect(source).toBeVisible()
    await expect(page.locator('#source-editor')).toHaveValue('')
    expect(await page.locator('#large-source-editor *').count()).toBeLessThan(2000)
    await source.focus()
    await page.keyboard.press('ControlOrMeta+End')
    await page.keyboard.insertText('尾部追加 🚀')
    await page.keyboard.press('ControlOrMeta+s')
    await expect.poll(() => readFile(join(app.userDataPath, 'large.md'), 'utf8'), { timeout: 15_000 }).toBe(content + '尾部追加 🚀')
    await page.keyboard.press('ControlOrMeta+z')
    await page.keyboard.press('ControlOrMeta+s')
    await expect.poll(() => readFile(join(app.userDataPath, 'large.md'), 'utf8'), { timeout: 15_000 }).toBe(content)
    await page.keyboard.press('ControlOrMeta+Shift+z')
    await page.keyboard.press('ControlOrMeta+s')
    await expect.poll(() => readFile(join(app.userDataPath, 'large.md'), 'utf8'), { timeout: 15_000 }).toBe(content + '尾部追加 🚀')
    await page.keyboard.press('ControlOrMeta+f')
    await page.locator('.search-input').fill('UNIQUE_END')
    await expect(page.locator('.search-count')).toHaveText('1/1')
    await page.keyboard.press('Escape')
    await page.keyboard.insertText('REPLACED_END')
    await page.keyboard.press('ControlOrMeta+s')
    await expect.poll(() => readFile(join(app.userDataPath, 'large.md'), 'utf8'), { timeout: 15_000 }).toBe(content.replace('UNIQUE_END', 'REPLACED_END') + '尾部追加 🚀')
    const external = content.replace('UNIQUE_END', 'EXTERNAL_END')
    await writeFile(join(app.userDataPath, 'large.md'), external)
    await expect(source).toContainText('EXTERNAL_END')
    await page.keyboard.press('ControlOrMeta+s')
    await expect.poll(() => readFile(join(app.userDataPath, 'large.md'), 'utf8'), { timeout: 15_000 }).toBe(external)
  } finally { await app.cleanup() }
})
