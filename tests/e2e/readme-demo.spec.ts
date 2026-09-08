import { expect, test } from '@playwright/test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchDraftMD } from '../helpers/electron-app'
import { startMockProviderServer } from '../helpers/mock-provider-server'

for (const locale of ['en', 'zh-CN'] as const) {
  test(`captures the README workflow with isolated demo documents (${locale})`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'draftmd-readme-'))
    const workspace = join(root, 'workspace')
    const userDataPath = join(root, 'profile')
    const chinese = locale === 'zh-CN'
    const content = chinese
      ? '# 产品发布计划\n\n在一个工作区里完成写作、整理与审阅。\n\n## 发布清单\n\n- [x] 整理用户反馈\n- [x] 完成编辑器验收\n- [ ] 更新使用说明\n- [ ] 发布新版本\n\n## 审阅状态\n\nStatus: before review\n\n## 写作原则\n\n**本地文件优先。** 每次修改都可以检查，重要决定由你确认。\n'
      : '# Product launch plan\n\nWrite, organize, and review in one workspace.\n\n## Launch checklist\n\n- [x] Collect user feedback\n- [x] Validate the editor\n- [ ] Update the user guide\n- [ ] Publish the release\n\n## Review status\n\nStatus: before review\n\n## Writing principles\n\n**Local files first.** Inspect every change and keep the final decision in your hands.\n'
    await Promise.all([mkdir(workspace), mkdir(userDataPath)])
    await mkdir(join(workspace, 'notes'))
    await Promise.all([
      writeFile(join(workspace, 'task.md'), content),
      writeFile(join(workspace, 'README.md'), '# Launch workspace\n\nProject plans, meeting notes, and decisions.\n'),
      writeFile(join(workspace, 'notes', 'meeting.md'), '# Meeting notes\n\nReview the user guide before release.\n'),
    ])
    const server = await startMockProviderServer('agent-task')
    const app = await launchDraftMD({ userDataPath, documentPath: join(workspace, 'task.md'), locale })
    try {
      const page = await app.windowMatching(async candidate => await candidate.locator('#file-title').textContent().catch(() => '') === 'task.md')
      await page.setViewportSize({ width: 1280, height: 800 })
      const capability = await page.evaluate(async ({ baseUrl, name }) => {
        const saved = await window.draftmd.saveProviderConfig({
          name, kind: 'openai-compatible', preset: 'none', baseUrl, apiMode: 'chat-completions',
          model: 'demo-model', timeoutMs: 5000, streamEnabled: true, toolsEnabled: true, insecureHttpApproved: false,
        }, {})
        return window.draftmd.testProviderConfig(saved.id)
      }, { baseUrl: server.baseUrl, name: chinese ? '本地演示' : 'Local demo' })
      expect(capability.capability).toBe('agent')
      await page.locator('#agent-model-button').click()
      await page.keyboard.press('Escape')
      await expect(page.locator('#file-list button[data-path="notes"]')).toBeVisible()
      await expect(page.locator('#editor .ProseMirror')).toContainText(chinese ? '产品发布计划' : 'Product launch plan')
      const prompt = chinese ? '将 task.md 的审阅状态从 before review 改为 after review，保留其他内容。' : 'Change the status in task.md from before review to after review. Keep everything else unchanged.'
      await page.locator('#agent-input').fill(prompt)
      await page.screenshot({ path: test.info().outputPath(`workspace-${locale}.png`) })
      await page.locator('#agent-send-button').click()
      await expect(page.locator('#agent-task-status')).toHaveText(chinese ? '已完成' : 'Completed', { timeout: 15_000 })
      await expect(page.locator('#editor .ProseMirror')).toContainText('Status: after review')
      const changes = page.locator('.agent-diff-file').filter({ hasText: 'task.md' })
      await changes.locator('summary').click()
      await expect(changes).toContainText('−Status: before review')
      await expect(changes).toContainText('+Status: after review')
      await expect(changes.locator('.visually-hidden').first()).toHaveCSS('position', 'absolute')
      await expect(changes.locator('.visually-hidden').first()).toHaveCSS('clip-path', 'inset(50%)')
      await page.screenshot({ path: test.info().outputPath(`review-${locale}.png`) })
      await page.locator('.agent-undo-task').focus()
      await page.keyboard.press('Enter')
      await expect(page.locator('#agent-task-status')).toHaveText(chinese ? '已撤销' : 'Undone')
      await expect.poll(() => readFile(join(workspace, 'task.md'), 'utf8')).toBe(content)
    } finally {
      await app.cleanup()
      await server.close()
      await rm(root, { recursive: true, force: true })
    }
  })
}
