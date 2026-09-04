import { expect, test } from '@playwright/test'
import { launchDraftMD } from '../helpers/electron-app'

test('previews localized safe diagnostic categories before export', async () => {
  const app = await launchDraftMD({
    locale: 'zh-CN', documentName: 'private.md',
    prepare: async (directory) => {
      const { writeFile } = await import('node:fs/promises')
      await writeFile(`${directory}/private.md`, '# PRIVATE_DOCUMENT_SENTINEL_7d12\n')
    },
  })
  try {
    const page = await app.windowMatching(async (candidate) => await candidate.locator('#file-title').textContent().catch(() => '') === 'private.md')
    await app.evaluate(({ Menu }) => {
      const item = Menu.getApplicationMenu()?.getMenuItemById('export-diagnostics')
      if (!item) throw new Error('Export Diagnostics menu item not found')
      item.click()
    })
    const dialog = page.locator('#diagnostics-dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('heading')).toHaveText('导出诊断信息')
    await expect(dialog.getByRole('listitem')).toHaveText(['应用信息', '安全设置', '模型服务元数据', '安全日志', '数据库完整性'])
    await expect(dialog).toContainText('不会包含提示词、回复、文档内容、凭据或敏感请求头')
    await expect(dialog).not.toContainText('PRIVATE_DOCUMENT_SENTINEL_7d12')
    await expect(dialog).not.toContainText('credentialRef')
    await expect(dialog.getByRole('button', { name: '取消' })).toBeFocused()
    await dialog.getByRole('button', { name: '取消' }).click()
    await expect(dialog).toBeHidden()
  } finally { await app.cleanup() }
})
