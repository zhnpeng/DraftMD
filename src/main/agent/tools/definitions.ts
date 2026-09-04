import type { ProviderTool } from '../../../shared/contracts/provider'

export const toolDefinitions: ProviderTool[] = [
  {
    name: 'list_markdown_files',
    description: 'List Markdown files in the current DraftMD workspace. Returns relative paths and metadata; never leaves the workspace.',
    inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  {
    name: 'search_markdown',
    description: 'Search Markdown text lexically in the current workspace. Results are bounded and include heading context.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 50 } }, required: ['query'], additionalProperties: false },
  },
  {
    name: 'read_markdown',
    description: 'Read one Markdown file, an exact heading section, or an explicit inclusive line range. Large whole-file reads return CONTENT_TOO_LARGE; request a heading or range instead.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' }, heading: { type: 'string' }, startLine: { type: 'integer', minimum: 1 }, endLine: { type: 'integer', minimum: 1 } }, required: ['path'], additionalProperties: false },
  },
  {
    name: 'create_markdown',
    description: 'Create one Markdown file inside the workspace. Never overwrites an existing path.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'], additionalProperties: false },
  },
  {
    name: 'edit_markdown',
    description: 'Replace one exact, unique text occurrence in a Markdown file. Requires the version returned by read_markdown; conflicts are rejected.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' }, oldText: { type: 'string' }, newText: { type: 'string' }, expectedVersion: { type: 'string' } }, required: ['path', 'oldText', 'newText', 'expectedVersion'], additionalProperties: false },
  },
  {
    name: 'rename_markdown',
    description: 'Rename or move one Markdown file inside the workspace. Requires the source version and never overwrites the destination.',
    inputSchema: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' }, expectedVersion: { type: 'string' } }, required: ['from', 'to', 'expectedVersion'], additionalProperties: false },
  },
  {
    name: 'delete_markdown',
    description: 'Request deletion of one Markdown file. DraftMD always pauses for explicit user approval and rechecks the expected version before deleting.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' }, expectedVersion: { type: 'string' }, reason: { type: 'string' } }, required: ['path', 'expectedVersion', 'reason'], additionalProperties: false },
  },
]
