import { beforeAll, describe, expect, it } from 'vitest'
const { buildForTests } = require('../../../scripts/build-for-tests.js')
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const projectRoot = resolve(import.meta.dirname, '../../..')
let rendererHtml = ''
let eagerJavaScript = ''

beforeAll(() => {
  buildForTests(projectRoot)
  rendererHtml = readFileSync(resolve(projectRoot, 'dist/renderer/index.html'), 'utf8')
  const eagerAssets = Array.from(rendererHtml.matchAll(/<(?:script|link)[^>]+(?:src|href)="([^"]+\.js)"/g), (match) => match[1])
  eagerJavaScript = eagerAssets.map((asset) => readFileSync(resolve(projectRoot, 'dist/renderer', asset), 'utf8')).join('\n')
}, 30_000)

describe('production renderer CSP', () => {
  it('keeps unsafe evaluation disabled', () => {
    expect(rendererHtml).toContain("script-src 'self'")
    expect(rendererHtml).not.toContain("'unsafe-eval'")
  })

  it('does not preload lodash global evaluation fallbacks', () => {
    expect(eagerJavaScript).not.toMatch(/Function\(["']return this["']\)/)
    expect(eagerJavaScript).not.toMatch(/\beval\s*\(/)
  })
})
