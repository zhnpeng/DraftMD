import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_APP_SCRIPT,
  formatDefaultAppResultDetails,
  logDefaultAppExecFailure,
  parseDefaultAppResults,
} from '../../../src/main/default-app'

describe('default app association results', () => {
  it('emits structured success/failure data without exception text', () => {
    expect(DEFAULT_APP_SCRIPT).toContain('results.push({ extension: ext, ok: status === \'0\' })')
    expect(DEFAULT_APP_SCRIPT).toContain('results.push({ extension: ext, ok: false })')
    expect(DEFAULT_APP_SCRIPT).not.toContain('e.message')
  })

  it('parses only structured per-extension results', () => {
    expect(parseDefaultAppResults('[{"extension":"md","ok":true},{"extension":"markdown","ok":false}]')).toEqual([
      { extension: 'md', ok: true },
      { extension: 'markdown', ok: false },
    ])
    expect(() => parseDefaultAppResults('["md: secret exception"]')).toThrow('Invalid default-app result')
  })

  it('formats visible results with catalog-only generic labels', () => {
    const results = [{ extension: 'md', ok: true }, { extension: 'markdown', ok: false }]
    expect(formatDefaultAppResultDetails('en', results)).toBe('md: Success\nmarkdown: Failed')
    expect(formatDefaultAppResultDetails('zh-CN', results)).toBe('md：成功\nmarkdown：失败')
  })

  it('logs raw exec diagnostics outside the user-visible message', () => {
    const logger = vi.fn()
    const error = new Error('osascript exploded')

    logDefaultAppExecFailure(error, 'native stderr', logger)

    expect(logger).toHaveBeenCalledWith('Default app association failed:', {
      error: 'osascript exploded',
      stderr: 'native stderr',
    })
  })
})
