import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

interface Finding { file: string; line: number; value: string; sink: string }
const ALLOWED_LITERAL = new Set(['×'])
const patterns: Array<[string, RegExp]> = [
  ['direct-property', /\.(textContent|innerText|title|placeholder)\s*=\s*(['"])([^'"]+)\2/],
  ['aria-label', /\.setAttribute\(\s*(['"])aria-label\1\s*,\s*(['"])([^'"]+)\2/],
  ['menu-label', /\blabel\s*:\s*(['"])([^'"]+)\1/],
]

export function hardcodedUISinks(source: string, file = '<source>'): Finding[] {
  const findings: Finding[] = []
  let inBlockComment = false
  source.split('\n').forEach((rawLine, index) => {
    let line = rawLine
    if (inBlockComment) {
      const end = line.indexOf('*/')
      if (end < 0) return
      line = line.slice(end + 2)
      inBlockComment = false
    }
    const block = line.indexOf('/*')
    if (block >= 0) {
      if (line.indexOf('*/', block + 2) < 0) inBlockComment = true
      line = line.slice(0, block)
    }
    line = line.replace(/\/\/.*$/, '')
    for (const [kind, pattern] of patterns) {
      const match = pattern.exec(line)
      if (!match) continue
      const sink = kind === 'direct-property' ? match[1] : kind
      const value = kind === 'direct-property' ? match[3] : kind === 'aria-label' ? match[3] : match[2]
      if (value && !ALLOWED_LITERAL.has(value)) findings.push({ file, line: index + 1, value, sink })
    }
  })
  return findings
}

function typescriptFiles(root: string): string[] {
  const files: string[] = []
  const visit = (directory: string): void => {
    for (const name of readdirSync(directory)) {
      const path = join(directory, name)
      if (statSync(path).isDirectory()) visit(path)
      else if (path.endsWith('.ts')) files.push(path)
    }
  }
  visit(root)
  return files.sort()
}

describe('hard-coded UI string gate', () => {
  it('detects direct visible and accessible string sinks', () => {
    const findings = hardcodedUISinks(`
      title.textContent = 'Visible title'
      input.placeholder = 'Type here'
      button.setAttribute('aria-label', 'Close panel')
      const item = { label: 'Native menu item' }
      icon.textContent = '×'
      status.textContent = msg('status.ready')
    `)
    expect(findings.map(({ sink, value }) => ({ sink, value }))).toEqual([
      { sink: 'textContent', value: 'Visible title' },
      { sink: 'placeholder', value: 'Type here' },
      { sink: 'aria-label', value: 'Close panel' },
      { sink: 'menu-label', value: 'Native menu item' },
    ])
  })

  it('keeps production UI literals in the shared catalogs', () => {
    const roots = ['src/main/app', 'src/renderer']
    const findings = roots.flatMap((root) => typescriptFiles(root).flatMap((file) =>
      hardcodedUISinks(readFileSync(file, 'utf8'), relative(process.cwd(), file))))
    expect(findings).toEqual([])
  })
})
