import { afterEach, describe, expect, it, vi } from 'vitest'

const parser = vi.hoisted(() => ({
  result: null as unknown,
  error: null as Error | null,
}))

vi.mock('mdast-util-from-markdown', () => ({
  fromMarkdown: vi.fn(() => {
    if (parser.error) throw parser.error
    return parser.result
  }),
}))

import { resolveImagePaths, restoreImagePaths } from '../../../src/main/documents/image-paths'

const source = 'private body ![image](./img/a.png)'
const diagnostic = '[image-paths] Markdown parsing failed; image paths left unchanged'

describe('Markdown parser failure', () => {
  afterEach(() => {
    parser.error = null
    parser.result = null
    vi.restoreAllMocks()
  })

  it('fails closed without logging source when parsing throws', () => {
    parser.error = new Error(`parser saw: ${source}`)
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(resolveImagePaths(source, '/work/spec.md')).toBe(source)
    expect(error).toHaveBeenCalledOnce()
    expect(error).toHaveBeenCalledWith(diagnostic)
  })

  it('fails closed when a protected node is missing absolute offsets', () => {
    parser.result = {
      type: 'root',
      children: [{ type: 'code', value: source, position: { start: {}, end: {} } }],
    }
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(restoreImagePaths('![image](file:///work/img/a.png)', '/work/spec.md')).toBe(
      '![image](file:///work/img/a.png)',
    )
    expect(error).toHaveBeenCalledOnce()
    expect(error).toHaveBeenCalledWith(diagnostic)
  })
})
