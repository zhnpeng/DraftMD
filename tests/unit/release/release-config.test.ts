import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

it('keeps hardened runtime entitlements minimal', () => {
  const entitlements = readFileSync('resources/entitlements.mac.plist', 'utf8')
  expect(entitlements).toContain('com.apple.security.cs.allow-jit')
  expect(entitlements).not.toContain('allow-unsigned-executable-memory')
  expect(entitlements).not.toContain('disable-library-validation')
})

it('runs every release gate in order before packaging', () => {
  const workflow = readFileSync('.github/workflows/release.yml', 'utf8')
  const gates = [
    'npm ci', 'npm run typecheck', 'npm run test', 'npm run test:integration',
    'npm run test:security', 'npm run test:e2e', 'npm run test:performance',
    'npm run build', 'npm run check:theme-colors', 'git diff --check',
  ]
  let cursor = -1
  for (const gate of gates) {
    const next = workflow.indexOf(gate)
    expect(next, gate).toBeGreaterThan(cursor)
    cursor = next
  }
  expect(workflow.indexOf('npm run dist:mac', cursor)).toBeGreaterThan(cursor)
})

it('fails closed for signed tags and never publishes workflow-dispatch builds', () => {
  const workflow = readFileSync('.github/workflows/release.yml', 'utf8')
  for (const secret of ['CSC_LINK', 'CSC_KEY_PASSWORD', 'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID']) {
    expect(workflow).toContain(secret)
  }
  expect(workflow).toContain('npm run dist:mac:signed')
  expect(workflow).toContain('CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist:mac')
  expect(workflow).toMatch(/release:\n\s+if: startsWith\(github\.ref, 'refs\/tags\/v'\)/)
  expect(workflow).toContain("github.event_name == 'workflow_dispatch'")
})

it('links release, privacy, and provider compatibility documentation', () => {
  for (const file of ['docs/release-checklist.md', 'docs/privacy.md', 'docs/provider-compatibility.md']) {
    expect(() => readFileSync(file, 'utf8')).not.toThrow()
    expect(readFileSync('README.md', 'utf8')).toContain(file)
    expect(readFileSync('README_CN.md', 'utf8')).toContain(file)
  }
})

it('ships upstream license and attribution with packaged applications', () => {
  const builder = readFileSync('electron-builder.yml', 'utf8')
  expect(builder).toMatch(/extraResources:[\s\S]*?- from: LICENSE\n\s+to: LICENSE/)
  expect(builder).toMatch(/extraResources:[\s\S]*?- from: NOTICE\.md\n\s+to: NOTICE\.md/)
  expect(builder).toContain('Copyright © 2026 marswave.ai and DraftMD contributors')
})
