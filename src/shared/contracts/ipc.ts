import { z } from 'zod'
import { AppBootstrapSchema } from './app'
import { AgentStartInputSchema, AgentStartResultSchema, ApprovalDecisionSchema, InterruptedTaskSummarySchema, SessionHistorySchema, TaskEventSchema } from './agent'
import { WorkspaceDescriptorSchema } from './workspace'
import { ChangeSetSchema, UndoResultSchema } from './changes'
import { DiagnosticsBundleSchema } from './diagnostics'
import { CapabilityTestResultSchema, ProviderConfigDTOSchema, ProviderConfigInputSchema, ProviderSecretsInputSchema } from './provider'
import { ModelSwitchSchema, SessionCreateSchema, SessionDTOSchema, SessionRenameSchema, UUIDv7Schema } from './session'
import {
  type DocumentSnapshot,
  DocumentSnapshotSchema,
  type FileOpened,
  FileOpenedSchema,
  MAX_DOCUMENT_LENGTH,
  MAX_PATH_LENGTH,
  type SiblingFile,
  SiblingFileSchema,
} from './document'

const PathSchema = z.string().min(1).max(MAX_PATH_LENGTH)
const WorkspaceDirectorySchema = z.string().max(MAX_PATH_LENGTH)
const OptionalPathSchema = PathSchema.optional()
const ContentSchema = z.string().max(MAX_DOCUMENT_LENGTH)
// 64K UTF-16 code units remain below 256 KiB when encoded as valid UTF-8.
export const SAVE_STREAM_CHUNK_LENGTH = 64 * 1024
export const MAX_SAVE_STREAM_LENGTH = 256 * 1024 * 1024
const SaveStreamIdSchema = z.string().uuid()
const SaveStreamBeginSchema = z.object({
  mode: z.enum(['save', 'save-as']),
  totalLength: z.number().int().min(1).max(MAX_SAVE_STREAM_LENGTH),
  expectedPath: OptionalPathSchema,
  rebuildMenu: z.boolean(),
}).strict()
const SaveStreamChunkSchema = z.string().min(1).max(SAVE_STREAM_CHUNK_LENGTH)
const ThemeSchema = z.enum([
  'light', 'dark', 'elegant', 'sepia', 'notion', 'bear', 'writer',
  'solarized-dark', 'nord', 'gruvbox', 'dracula', 'midnight',
])
type Exact<T, Shape> = T extends Shape ? Exclude<keyof T, keyof Shape> extends never ? T : never : never

const VersionSchema = z.string().min(1).max(128)
const ExternalFileChangeSchema = z.object({ path: PathSchema, content: ContentSchema, version: VersionSchema }).strict()
const RequestIdSchema = z.string().min(1).max(256)
const EditorFontSchema = z.object({
  family: z.string().max(512),
  size: z.union([z.literal(0), z.number().int().min(10).max(40)]),
}).strict()
const ExportHTMLSchema = z.object({
  content: ContentSchema,
  html: z.string().max(MAX_DOCUMENT_LENGTH),
  styles: z.string().max(MAX_DOCUMENT_LENGTH),
  bodyClass: z.string().max(4096),
  background: z.string().max(256),
}).strict()
const ExternalConflictResultSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('keep') }).strict(),
  z.object({ action: z.literal('load'), content: ContentSchema }).strict(),
])
const WebURLSchema = z.string().max(8192).url().refine(
  (url) => url.startsWith('https://') || url.startsWith('http://'),
  { message: 'Only HTTP(S) URLs are allowed' },
)

export const IpcInvokeSchemas = {
  'session-history': { args: z.tuple([UUIDv7Schema]), result: SessionHistorySchema },
  'session-list': { args: z.tuple([z.string().regex(/^[a-f0-9]{64}$/)]), result: z.array(SessionDTOSchema) },
  'session-create': { args: z.tuple([SessionCreateSchema]), result: SessionDTOSchema },
  'session-rename': { args: z.tuple([SessionRenameSchema]), result: z.boolean() },
  'session-delete': { args: z.tuple([UUIDv7Schema]), result: z.boolean() },
  'session-switch-model': { args: z.tuple([ModelSwitchSchema]), result: z.void() },
  'agent-start': { args: z.tuple([AgentStartInputSchema]), result: AgentStartResultSchema },
  'agent-task-changes': { args: z.tuple([UUIDv7Schema]), result: ChangeSetSchema },
  'agent-task-undo': { args: z.tuple([UUIDv7Schema]), result: UndoResultSchema },
  'agent-stop': { args: z.tuple([UUIDv7Schema]), result: z.boolean() },
  'agent-respond-approval': {
    args: z.tuple([ApprovalDecisionSchema]),
    result: z.boolean(),
  },
  'agent-list-interrupted': {
    args: z.tuple([]),
    result: z.array(InterruptedTaskSummarySchema),
  },
  'agent-keep-interrupted': {
    args: z.tuple([UUIDv7Schema]),
    result: z.boolean(),
  },
  'agent-undo-interrupted': {
    args: z.tuple([UUIDv7Schema]),
    result: z.unknown(),
  },
  'provider-list': {
    args: z.tuple([]),
    result: z.array(ProviderConfigDTOSchema),
  },
  'provider-save': {
    args: z.tuple([ProviderConfigInputSchema, ProviderSecretsInputSchema]),
    result: ProviderConfigDTOSchema,
  },
  'provider-test': {
    args: z.tuple([UUIDv7Schema]),
    result: CapabilityTestResultSchema,
  },
  'provider-set-default': {
    args: z.tuple([UUIDv7Schema]),
    result: z.void(),
  },
  'provider-delete': {
    args: z.tuple([UUIDv7Schema, z.boolean()]),
    result: z.boolean(),
  },
  'current-document-version': {
    args: z.tuple([]),
    result: VersionSchema.nullable(),
  },
  'open-workspace': {
    args: z.tuple([]),
    result: WorkspaceDescriptorSchema.nullable(),
  },
  'list-workspace-files': {
    args: z.tuple([WorkspaceDirectorySchema]),
    result: z.array(SiblingFileSchema).max(100_000).nullable(),
  },
  'open-workspace-file': {
    args: z.tuple([PathSchema]),
    result: z.boolean(),
  },
  'open-file': {
    args: z.tuple([]),
    result: FileOpenedSchema.nullable(),
  },
  'open-file-path': {
    args: z.tuple([PathSchema]),
    result: FileOpenedSchema.nullable(),
  },
  'list-siblings': {
    args: z.tuple([]),
    result: z.array(SiblingFileSchema).max(100_000).nullable(),
  },
  'open-sibling': {
    args: z.tuple([PathSchema]),
    result: z.boolean(),
  },
  'save-file': {
    args: z.tuple([ContentSchema, OptionalPathSchema, z.boolean().optional()]),
    result: PathSchema.nullable(),
  },
  'save-file-as': {
    args: z.tuple([ContentSchema, OptionalPathSchema]),
    result: PathSchema.nullable(),
  },
  'save-stream-begin': {
    args: z.tuple([SaveStreamBeginSchema]),
    result: SaveStreamIdSchema,
  },
  'save-stream-chunk': {
    args: z.tuple([SaveStreamIdSchema, z.number().int().nonnegative(), SaveStreamChunkSchema]),
    result: z.boolean(),
  },
  'save-stream-commit': {
    args: z.tuple([SaveStreamIdSchema]),
    result: PathSchema.nullable(),
  },
  'export-pdf': {
    args: z.tuple([]),
    result: z.boolean(),
  },
  'export-html': {
    args: z.tuple([ExportHTMLSchema]),
    result: z.boolean(),
  },
  'report-theme': {
    args: z.tuple([ThemeSchema]),
    result: z.void(),
  },
  'set-app-locale': { args: z.tuple([z.enum(['en', 'zh-CN'])]), result: z.void() },
  'set-editor-font': {
    args: z.tuple([EditorFontSchema]),
    result: z.void(),
  },
  'list-system-fonts': {
    args: z.tuple([]),
    result: z.array(z.string().min(1).max(512)).max(100_000),
  },
  'report-external-conflict': {
    args: z.tuple([]),
    result: z.void(),
  },
  'diagnostics-preview': { args: z.tuple([]), result: DiagnosticsBundleSchema },
  'diagnostics-export': { args: z.tuple([]), result: z.boolean() },
  'download-update': {
    args: z.tuple([]),
    result: z.boolean(),
  },
  'install-update': {
    args: z.tuple([]),
    result: z.boolean(),
  },
} as const

export const IpcSendSchemas = {
  'open-external': z.tuple([WebURLSchema]),
  'set-dirty': z.tuple([z.boolean()]),
  'renderer-ready': z.tuple([]),
  'document-state-response': z.tuple([RequestIdSchema, DocumentSnapshotSchema]),
  'acknowledge-external-version': z.tuple([PathSchema, VersionSchema]),
} as const

export const IpcEventSchemas = {
  'app-bootstrap': z.tuple([AppBootstrapSchema]),
  'file-opened': z.tuple([FileOpenedSchema]),
  'workspace:opened': z.tuple([WorkspaceDescriptorSchema]),
  'workspace:files-changed': z.tuple([]),
  'file-changed': z.tuple([ContentSchema]),
  'document-snapshot-changed': z.tuple([ExternalFileChangeSchema]),
  'autosave-retry-paused': z.tuple([]),
  'menu-open': z.tuple([]),
  'menu-save': z.tuple([]),
  'menu-save-as': z.tuple([]),
  'menu-export-pdf': z.tuple([]),
  'menu-export-html': z.tuple([]),
  'set-theme': z.tuple([ThemeSchema]),
  'agent-activity': z.tuple([z.enum(['idle', 'active', 'cooldown'])]),
  'agent-task-event': z.tuple([TaskEventSchema]),
  'editor:search': z.tuple([]),
  'editor:math': z.tuple([]),
  'siblings-changed': z.tuple([z.array(SiblingFileSchema).max(100_000)]),
  'toggle-file-panel': z.tuple([]),
  'focus-agent-dock': z.tuple([]),
  'toggle-source-mode': z.tuple([]),
  'editor-font-changed': z.tuple([EditorFontSchema]),
  'open-font-settings': z.tuple([]),
  'open-diagnostics': z.tuple([]),
  'open-onboarding': z.tuple([]),
  'open-provider-settings': z.tuple([]),
  'external-conflict-result': z.tuple([ExternalConflictResultSchema]),
  'update-available': z.tuple([VersionSchema]),
  'update-downloaded': z.tuple([VersionSchema]),
  'request-document-state': z.tuple([RequestIdSchema]),
} as const

type SchemaMap = Record<string, z.ZodType>
type TupleMap<T extends SchemaMap> = { [Channel in keyof T]: z.infer<T[Channel]> }

export type IpcInvokeMap = {
  [Channel in keyof typeof IpcInvokeSchemas]: {
    args: z.infer<(typeof IpcInvokeSchemas)[Channel]['args']>
    result: z.infer<(typeof IpcInvokeSchemas)[Channel]['result']>
  }
}
export type IpcSendMap = TupleMap<typeof IpcSendSchemas>
export type IpcEventMap = TupleMap<typeof IpcEventSchemas>

export type Unsubscribe = () => void

export interface DraftMDAPI {
  onAppBootstrap(callback: (bootstrap: import('./app').AppBootstrap) => void): Unsubscribe
  getSessionHistory(...args: IpcInvokeMap['session-history']['args']): Promise<IpcInvokeMap['session-history']['result']>
  listSessions(...args: IpcInvokeMap['session-list']['args']): Promise<IpcInvokeMap['session-list']['result']>
  createSession(...args: IpcInvokeMap['session-create']['args']): Promise<IpcInvokeMap['session-create']['result']>
  renameSession(...args: IpcInvokeMap['session-rename']['args']): Promise<IpcInvokeMap['session-rename']['result']>
  deleteSession(...args: IpcInvokeMap['session-delete']['args']): Promise<IpcInvokeMap['session-delete']['result']>
  switchSessionModel(...args: IpcInvokeMap['session-switch-model']['args']): Promise<IpcInvokeMap['session-switch-model']['result']>
  startAgentTask(...args: IpcInvokeMap['agent-start']['args']): Promise<IpcInvokeMap['agent-start']['result']>
  getAgentTaskChanges(...args: IpcInvokeMap['agent-task-changes']['args']): Promise<IpcInvokeMap['agent-task-changes']['result']>
  undoAgentTask(...args: IpcInvokeMap['agent-task-undo']['args']): Promise<IpcInvokeMap['agent-task-undo']['result']>
  stopAgentTask(...args: IpcInvokeMap['agent-stop']['args']): Promise<IpcInvokeMap['agent-stop']['result']>
  respondToAgentApproval(...args: IpcInvokeMap['agent-respond-approval']['args']): Promise<IpcInvokeMap['agent-respond-approval']['result']>
  listInterruptedTasks(...args: IpcInvokeMap['agent-list-interrupted']['args']): Promise<IpcInvokeMap['agent-list-interrupted']['result']>
  keepInterruptedTask(...args: IpcInvokeMap['agent-keep-interrupted']['args']): Promise<IpcInvokeMap['agent-keep-interrupted']['result']>
  undoInterruptedTask(...args: IpcInvokeMap['agent-undo-interrupted']['args']): Promise<IpcInvokeMap['agent-undo-interrupted']['result']>
  listProviderConfigs(...args: IpcInvokeMap['provider-list']['args']): Promise<IpcInvokeMap['provider-list']['result']>
  saveProviderConfig(...args: IpcInvokeMap['provider-save']['args']): Promise<IpcInvokeMap['provider-save']['result']>
  testProviderConfig(...args: IpcInvokeMap['provider-test']['args']): Promise<IpcInvokeMap['provider-test']['result']>
  setDefaultProvider(...args: IpcInvokeMap['provider-set-default']['args']): Promise<IpcInvokeMap['provider-set-default']['result']>
  deleteProviderConfig(...args: IpcInvokeMap['provider-delete']['args']): Promise<IpcInvokeMap['provider-delete']['result']>
  currentDocumentVersion(...args: IpcInvokeMap['current-document-version']['args']): Promise<IpcInvokeMap['current-document-version']['result']>
  openWorkspace(...args: IpcInvokeMap['open-workspace']['args']): Promise<IpcInvokeMap['open-workspace']['result']>
  listWorkspaceFiles(...args: IpcInvokeMap['list-workspace-files']['args']): Promise<IpcInvokeMap['list-workspace-files']['result']>
  openWorkspaceFile(...args: IpcInvokeMap['open-workspace-file']['args']): Promise<IpcInvokeMap['open-workspace-file']['result']>
  openFile(): Promise<FileOpened | null>
  openFilePath(path: string): Promise<FileOpened | null>
  listSiblings(): Promise<SiblingFile[] | null>
  openSibling(...args: IpcInvokeMap['open-sibling']['args']): Promise<IpcInvokeMap['open-sibling']['result']>
  saveFile(...args: IpcInvokeMap['save-file']['args']): Promise<IpcInvokeMap['save-file']['result']>
  saveFileAs(...args: IpcInvokeMap['save-file-as']['args']): Promise<IpcInvokeMap['save-file-as']['result']>
  exportPDF(...args: IpcInvokeMap['export-pdf']['args']): Promise<IpcInvokeMap['export-pdf']['result']>
  exportHTML(...args: IpcInvokeMap['export-html']['args']): Promise<IpcInvokeMap['export-html']['result']>
  reportTheme(...args: IpcInvokeMap['report-theme']['args']): Promise<IpcInvokeMap['report-theme']['result']>
  getPathForFile(file: File): string
  openExternal(...args: IpcSendMap['open-external']): void
  onFileChanged(callback: (content: string) => void): Unsubscribe
  onDocumentSnapshotChanged(callback: (...args: IpcEventMap['document-snapshot-changed']) => void): Unsubscribe
  onAutosaveRetryPaused(callback: () => void): Unsubscribe
  onFileOpened(callback: (data: FileOpened) => void): Unsubscribe
  onWorkspaceOpened(callback: (...args: IpcEventMap['workspace:opened']) => void): Unsubscribe
  onWorkspaceFilesChanged(callback: (...args: IpcEventMap['workspace:files-changed']) => void): Unsubscribe
  onMenuOpen(callback: (...args: IpcEventMap['menu-open']) => void): Unsubscribe
  onMenuSave(callback: (...args: IpcEventMap['menu-save']) => void): Unsubscribe
  onMenuSaveAs(callback: (...args: IpcEventMap['menu-save-as']) => void): Unsubscribe
  onMenuExportPDF(callback: (...args: IpcEventMap['menu-export-pdf']) => void): Unsubscribe
  onMenuExportHTML(callback: (...args: IpcEventMap['menu-export-html']) => void): Unsubscribe
  onSetTheme(callback: (...args: IpcEventMap['set-theme']) => void): Unsubscribe
  onAgentTaskEvent(callback: (...args: IpcEventMap['agent-task-event']) => void): Unsubscribe
  onAgentActivity(callback: (...args: IpcEventMap['agent-activity']) => void): Unsubscribe
  onSearch(callback: (...args: IpcEventMap['editor:search']) => void): Unsubscribe
  onMathModal(callback: (...args: IpcEventMap['editor:math']) => void): Unsubscribe
  onSiblingsChanged(callback: (files: SiblingFile[]) => void): Unsubscribe
  onFocusAgentDock(callback: (...args: IpcEventMap['focus-agent-dock']) => void): Unsubscribe
  onToggleFilePanel(callback: (...args: IpcEventMap['toggle-file-panel']) => void): Unsubscribe
  onToggleSourceMode(callback: (...args: IpcEventMap['toggle-source-mode']) => void): Unsubscribe
  setAppLocale(...args: IpcInvokeMap['set-app-locale']['args']): Promise<IpcInvokeMap['set-app-locale']['result']>
  setEditorFont(...args: IpcInvokeMap['set-editor-font']['args']): Promise<IpcInvokeMap['set-editor-font']['result']>
  listSystemFonts(...args: IpcInvokeMap['list-system-fonts']['args']): Promise<IpcInvokeMap['list-system-fonts']['result']>
  onEditorFontChanged(callback: (...args: IpcEventMap['editor-font-changed']) => void): Unsubscribe
  onOpenDiagnostics(callback: () => void): Unsubscribe
  onOpenOnboarding(callback: () => void): Unsubscribe
  onOpenProviderSettings(callback: (...args: IpcEventMap['open-provider-settings']) => void): Unsubscribe
  onOpenFontSettings(callback: (...args: IpcEventMap['open-font-settings']) => void): Unsubscribe
  reportExternalConflict(...args: IpcInvokeMap['report-external-conflict']['args']): Promise<IpcInvokeMap['report-external-conflict']['result']>
  onExternalConflictResult(callback: (...args: IpcEventMap['external-conflict-result']) => void): Unsubscribe
  onUpdateAvailable(callback: (...args: IpcEventMap['update-available']) => void): Unsubscribe
  onUpdateDownloaded(callback: (...args: IpcEventMap['update-downloaded']) => void): Unsubscribe
  previewDiagnostics(...args: IpcInvokeMap['diagnostics-preview']['args']): Promise<IpcInvokeMap['diagnostics-preview']['result']>
  exportDiagnostics(...args: IpcInvokeMap['diagnostics-export']['args']): Promise<IpcInvokeMap['diagnostics-export']['result']>
  downloadUpdate(...args: IpcInvokeMap['download-update']['args']): Promise<IpcInvokeMap['download-update']['result']>
  installUpdate(...args: IpcInvokeMap['install-update']['args']): Promise<IpcInvokeMap['install-update']['result']>
  reportDirty(...args: IpcSendMap['set-dirty']): void
  reportRendererReady(...args: IpcSendMap['renderer-ready']): void
  acknowledgeExternalVersion(...args: IpcSendMap['acknowledge-external-version']): void
  onRequestDocumentState(callback: (...args: IpcEventMap['request-document-state']) => void): Unsubscribe
  respondDocumentState<Snapshot extends DocumentSnapshot>(requestId: string, snapshot: Exact<Snapshot, DocumentSnapshot>): void
}
