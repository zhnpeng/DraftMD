import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import pkg from '../../package.json'

const builder = readFileSync('electron-builder.yml', 'utf8')

it('uses the DraftMD package identity', () => {
  expect(pkg.name).toBe('draftmd')
  expect(pkg.productName).toBe('DraftMD')
  expect(pkg.description).toContain('AI Markdown')
})

it('builds an isolated unsigned Universal candidate without publishing implicitly', () => {
  const command = pkg.scripts['dist:mac']
  for (const required of [
    'electron-vite build',
    'npm run prepare:native-packages',
    'cd .build/package',
    '--mac --universal',
    '--publish never',
    '--config.mac.identity=null',
    '--config.mac.notarize=false',
  ]) expect(command).toContain(required)
  expect(command).not.toMatch(/--publish\s+(?:always|onTag|onTagOrDraft)/)
})

it('ships only macOS Universal artifacts', () => {
  expect(builder).toContain('appId: app.draftmd.desktop')
  expect(builder).not.toContain('\nwin:')
  expect(builder).not.toContain('\nlinux:')
  expect(builder).not.toContain('\nnsis:')
})
