import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { assertCatalogParity, detectLocale, t } from '../../../src/shared/i18n'

describe('i18n', () => {
  it('keeps both catalogs structurally identical', () => {
    expect(() => assertCatalogParity()).not.toThrow()
  })

  it.each([
    ['zh-CN', 'zh-CN'],
    ['zh-Hans-US', 'zh-CN'],
    ['en-US', 'en'],
    ['fr-FR', 'en'],
  ] as const)('maps %s to %s', (input, expected) => {
    expect(detectLocale(input)).toBe(expected)
  })

  it('interpolates named values', () => {
    expect(t('en', 'files.count', { count: 3 })).toBe('3 files')
    expect(t('zh-CN', 'files.count', { count: 3 })).toBe('3 个文件')
  })

  it('rejects missing interpolation values', () => {
    expect(() => t('en', 'files.count')).toThrow('count')
  })
})

describe('catalog adoption', () => {
  it('makes shared source part of every target-local build', () => {
    for (const file of ['tsconfig.main.json', 'tsconfig.preload.json', 'tsconfig.renderer.json']) {
      const config = JSON.parse(readFileSync(file, 'utf8')) as {
        compilerOptions: { rootDir?: string }
        include: string[]
      }
      expect(config.compilerOptions.rootDir, file).toBe('src')
      expect(config.include, file).toContain('src/shared/**/*')
    }
  })

  it('removes representative legacy UI copy from production TypeScript', () => {
    const files = [
      'src/main/index.ts',
      'src/renderer/main.ts',
      'src/renderer/editor/editor.ts',
      'src/renderer/editor/font-settings.ts',
      'src/renderer/editor/math-modal.ts',
      'src/renderer/editor/mermaid-view.ts',
      'src/renderer/editor/mermaid-bridge.ts',
      'src/renderer/editor/search-panel.ts',
    ]
    const source = files.map((file) => readFileSync(file, 'utf8')).join('\n')
    for (const legacy of [
      '文件已被其他程序修改',
      '未保存的修改',
      'Unable to check for updates',
      '切换回所见即所得',
      '文件已被外部修改',
      'Edit LaTeX Formula',
      'Mermaid 渲染失败',
      '渲染超时，已重置渲染器',
      '语法错误',
      "this.input.placeholder = 'Search...'",
      "button.textContent = '复制'",
      "detail: results.join('\\n')",
      'detail: error instanceof Error ? error.message : String(error)',
      'detail: stderr || error.message',
      "{ message: reason.message }",
      "sizeInput.placeholder = '16'",
    ]) {
      expect(source, legacy).not.toContain(legacy)
    }
  })

  it('marks every bootstrap label for catalog replacement', () => {
    const html = readFileSync('src/renderer/index.html', 'utf8')
    expect(html).toContain('<title data-i18n="app.name">DraftMD</title>')
    expect(html).toContain('data-i18n="document.untitled"')
    expect(html).toContain('data-i18n-aria-label="toolbar.documentStats"')
    expect(html).toContain('data-i18n="files.title"')
    expect(html).toContain('data-i18n="files.outline"')
    expect(html).not.toContain('Agent 状态')
    expect(html).not.toContain('发现新版本')
  })
})

describe('locale bootstrap ordering', () => {
  it('does not snapshot locale-dependent editor copy during module evaluation', () => {
    const editor = readFileSync('src/renderer/editor/editor.ts', 'utf8')
    const mathModal = readFileSync('src/renderer/editor/math-modal.ts', 'utf8')
    expect(editor).not.toContain('const defaultContent =')
    expect(mathModal).not.toContain('export const mathModal = new MathModal()')
  })
})

it('localizes diagnostics and database recovery notices in both catalogs', () => {
  for (const locale of ['en', 'zh-CN'] as const) {
    expect(t(locale, 'menu.exportDiagnostics')).not.toHaveLength(0)
    expect(t(locale, 'diagnostics.title')).not.toHaveLength(0)
    expect(t(locale, 'diagnostics.detail')).not.toHaveLength(0)
    expect(t(locale, 'diagnostics.excluded')).not.toHaveLength(0)
    expect(t(locale, 'diagnostics.export')).not.toHaveLength(0)
    expect(t(locale, 'database.recovered')).not.toHaveLength(0)
    expect(t(locale, 'database.memoryFallback')).not.toHaveLength(0)
  }
})

it('localizes stable diagnostics category identifiers for display', async () => {
  const { diagnosticsCategoryLabel } = await import('../../../src/renderer/app/diagnostics')
  const expected = { en: 'Database integrity', 'zh-CN': '数据库完整性' } as const
  for (const locale of ['en', 'zh-CN'] as const) {
    const { setLocale } = await import('../../../src/shared/i18n')
    setLocale(locale)
    expect(diagnosticsCategoryLabel('Database integrity')).toBe(expected[locale])
  }
})
