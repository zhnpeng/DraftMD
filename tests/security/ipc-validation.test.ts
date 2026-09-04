import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { IpcInvokeSchemas } from '../../src/shared/contracts/ipc'

const uuid = '01991d5a-1c00-7000-8000-000000000001'
const workspaceId = 'a'.repeat(64)
const version = 'b'.repeat(64)
const providerInput = {
  name: 'Local', kind: 'openai-compatible', preset: 'none', baseUrl: 'http://127.0.0.1:1234/v1',
  model: 'mock', timeoutMs: 60_000, streamEnabled: true, toolsEnabled: true, insecureHttpApproved: false,
}
const valid: Record<keyof typeof IpcInvokeSchemas, unknown[]> = {
  'session-history': [uuid], 'session-list': [workspaceId],
  'session-create': [{ workspaceId, title: 'Session' }], 'session-rename': [{ id: uuid, title: 'Renamed' }],
  'session-delete': [uuid], 'session-switch-model': [{ sessionId: uuid, providerConfigId: uuid }],
  'agent-start': [{ workspaceId, providerConfigId: uuid, prompt: 'Task', currentPath: null, currentContent: null, selection: null }],
  'agent-task-changes': [uuid], 'agent-task-undo': [uuid], 'agent-stop': [uuid],
  'agent-respond-approval': [{ taskId: uuid, approvalId: 'approval', decision: 'deny' }],
  'agent-list-interrupted': [], 'agent-keep-interrupted': [uuid], 'agent-undo-interrupted': [uuid],
  'provider-list': [], 'provider-save': [providerInput, {}], 'provider-test': [uuid], 'provider-set-default': [uuid],
  'provider-delete': [uuid, false], 'current-document-version': [], 'diagnostics-preview': [], 'diagnostics-export': [], 'open-workspace': [],
  'list-workspace-files': [''], 'open-workspace-file': ['note.md'], 'open-file': [], 'open-file-path': ['/tmp/note.md'],
  'list-siblings': [], 'open-sibling': ['/tmp/note.md'], 'save-file': ['# Note', '/tmp/note.md', false],
  'save-file-as': ['# Note', '/tmp/note.md'],
  'save-stream-begin': [{ mode: 'save', totalLength: 3, expectedPath: '/tmp/note.md', rebuildMenu: false }],
  'save-stream-chunk': [uuid, 0, 'abc'], 'save-stream-commit': [uuid], 'export-pdf': [],
  'export-html': [{ content: '# Note', html: '<h1>Note</h1>', styles: '', bodyClass: '', background: '#fff' }],
  'report-theme': ['light'], 'set-app-locale': ['en'], 'set-editor-font': [{ family: '', size: 0 }],
  'list-system-fonts': [], 'report-external-conflict': [], 'download-update': [], 'install-update': [],
}

const clone = (value: unknown): unknown => structuredClone(value)

describe('strict IPC invoke validation', () => {
  it('has one maintained valid fixture for every invoke channel', () => {
    expect(Object.keys(valid).sort()).toEqual(Object.keys(IpcInvokeSchemas).sort())
    for (const channel of Object.keys(IpcInvokeSchemas) as Array<keyof typeof IpcInvokeSchemas>) {
      expect(IpcInvokeSchemas[channel].args.safeParse(valid[channel]).success, channel).toBe(true)
    }
  })

  it('rejects missing, extra, and wrong-primitive arguments on every channel', () => {
    for (const channel of Object.keys(IpcInvokeSchemas) as Array<keyof typeof IpcInvokeSchemas>) {
      const schema = IpcInvokeSchemas[channel].args
      const args = valid[channel]
      if (args.length) expect(schema.safeParse([]).success, `${channel}: missing`).toBe(false)
      expect(schema.safeParse([...args, '__extra__']).success, `${channel}: extra`).toBe(false)
      const wrong = args.length ? [42, ...args.slice(1)] : [42]
      expect(schema.safeParse(wrong).success, `${channel}: wrong primitive`).toBe(false)
    }
  })

  it('rejects extra and prototype-like keys in every object argument', () => {
    const prototypeKey = JSON.parse('{"__proto__":{"polluted":true}}')
    for (const channel of Object.keys(IpcInvokeSchemas) as Array<keyof typeof IpcInvokeSchemas>) {
      const args = valid[channel]
      args.forEach((value, index) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return
        const extra = clone(args) as unknown[]
        extra[index] = { ...(value as object), unexpectedField: true }
        expect(IpcInvokeSchemas[channel].args.safeParse(extra).success, `${channel}: strict extra`).toBe(false)
        const polluted = clone(args) as unknown[]
        polluted[index] = Object.assign({}, value, prototypeKey)
        expect(IpcInvokeSchemas[channel].args.safeParse(polluted).success, `${channel}: prototype key`).toBe(false)
      })
    }
  })

  it.each([
    ['session-create', [{ workspaceId, title: 'x'.repeat(513) }]],
    ['open-file-path', ['x'.repeat(32 * 1024 + 1)]],
    ['open-workspace-file', ['x'.repeat(32 * 1024 + 1)]],
    ['provider-save', [{ ...providerInput, model: 'x'.repeat(513) }, {}]],
    ['export-html', [{ content: '', html: '', styles: '', bodyClass: 'x'.repeat(4097), background: '' }]],
  ] as const)('rejects bounded oversized strings on %s', (channel, args) => {
    expect(IpcInvokeSchemas[channel].args.safeParse(args).success).toBe(false)
  })

  it.each([
    ['report-theme', ['neon']], ['set-app-locale', ['fr']],
    ['provider-save', [{ ...providerInput, kind: 'unknown' }, {}]],
    ['agent-respond-approval', [{ taskId: uuid, approvalId: 'approval', decision: 'always' }]],
  ] as const)('rejects invalid enum values on %s', (channel, args) => {
    expect(IpcInvokeSchemas[channel].args.safeParse(args).success).toBe(false)
  })

  it('parses arguments before invoking main handlers', () => {
    const source = readFileSync('src/main/app/ipc.ts', 'utf8')
    expect(source.indexOf('schema.args.safeParse(rawArgs)')).toBeLessThan(source.indexOf('await handler(event'))
  })
})
