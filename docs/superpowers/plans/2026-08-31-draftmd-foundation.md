# DraftMD Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the ColaMD source into a branded, macOS-only DraftMD editor with a tested build, focused process boundaries, and complete Chinese/English UI infrastructure.

**Architecture:** Copy the ColaMD working tree without Git history, preserve the proven Milkdown editor, and introduce composition roots plus shared contracts before any AI code. Main-process window, document, menu, and IPC concerns move into focused modules while retaining observable behavior.

**Tech Stack:** Electron 44, electron-vite 5, Vite 7, TypeScript 7, Milkdown 7, Vitest 4, Playwright 1.62, Zod 4.

**Spec:** `docs/superpowers/specs/2026-08-31-draftmd-product-design.md`

## Global Constraints

- macOS 13+ only, Universal Apple Silicon + Intel.
- Preserve ColaMD MIT attribution; new DraftMD code remains MIT unless the owner later chooses another compatible license.
- Retain WYSIWYG/source mode, autosave, external-change synchronization, files/outline, search, images, tables, tasks, code, Mermaid, LaTeX, light/dark themes, HTML and PDF export.
- Remove Word/image export, custom-theme import, Windows/Linux packaging, and user-facing multi-window creation from MVP.
- `contextIsolation: true`; `nodeIntegration: false`; no renderer filesystem access.
- Every user-facing string comes from `src/shared/i18n`.

---

### Task 1: Import the ColaMD Baseline and Establish Tests

**Files:**
- Copy: `/Users/jasper/Work/ColaMD/*` → project root, excluding `.git`
- Preserve: `docs/superpowers/**`
- Modify: `.gitignore`
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `tests/unit/smoke.test.ts`

**Interfaces:**
- Consumes: ColaMD v2.0.1 working tree at commit `4c77dbf`.
- Produces: `npm run typecheck`, `npm run test`, and `npm run build` baseline commands.

- [ ] **Step 1: Copy the source without source repository metadata**

Run:

```bash
rsync -a --exclude=.git --exclude=.superpowers /Users/jasper/Work/ColaMD/ /Users/jasper/Work/mdassit/
printf '\n.superpowers/\nartifacts/\nrelease/\n' >> /Users/jasper/Work/mdassit/.gitignore
```

Expected: ColaMD source appears in `mdassit`; the confirmed spec and plans remain present; `/Users/jasper/Work/mdassit/.git` does not exist.

- [ ] **Step 2: Record the untouched baseline behavior**

Run:

```bash
npm install
npm run build
npm run check:theme-colors
git diff --check --no-index /dev/null /Users/jasper/Work/mdassit/package.json || test $? -eq 1
```

Expected: install and build exit 0. Record any failure before changing dependencies; do not label it pre-existing without this output.

- [ ] **Step 3: Add test and typecheck scripts**

Update `package.json` scripts to include:

```json
{
  "typecheck": "tsc -b --noEmit",
  "test": "vitest run",
  "test:watch": "vitest",
  "test:integration": "vitest run --config vitest.integration.config.ts",
  "test:e2e": "playwright test"
}
```

Add development dependencies `vitest@^4.1.11`, `@playwright/test@^1.62.1`, and `zod@^4.5.4`.

- [ ] **Step 4: Write the failing smoke test**

Create `tests/unit/smoke.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import pkg from '../../package.json'

describe('DraftMD foundation', () => {
  it('is branded as DraftMD', () => {
    expect(pkg.name).toBe('draftmd')
    expect(pkg.productName).toBe('DraftMD')
  })
})
```

Run: `npm run test -- tests/unit/smoke.test.ts`

Expected: FAIL because the package is still named `colamd` and has no `productName` field.

- [ ] **Step 5: Keep the failure for Task 2 and verify the test harness itself works**

Temporarily run:

```bash
npx vitest run tests/unit/smoke.test.ts --reporter=verbose
```

Expected: one discovered test and one assertion failure, not a configuration/import error.

- [ ] **Step 6: Commit when repository commits are authorized**

```bash
git add .gitignore package.json package-lock.json vitest.config.ts tests/unit/smoke.test.ts docs/superpowers

git commit -m "test: establish DraftMD baseline"
```

Do not execute this commit step unless the user has explicitly authorized commits.

---

### Task 2: Brand and Constrain the macOS Product

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `electron-builder.yml`
- Modify: `.github/workflows/release.yml`
- Modify: `src/main/index.ts`
- Modify: `src/renderer/index.html`
- Modify: `src/renderer/editor/editor.ts`
- Modify: `README.md`
- Modify: `README_CN.md`
- Modify: `LICENSE`
- Delete: `src/main/docx-export.ts`
- Delete: `src/main/image-export.ts`

**Interfaces:**
- Consumes: baseline scripts from Task 1.
- Produces: package identity `draftmd`, product name `DraftMD`, app ID `app.draftmd.desktop`, mac-only `dist:mac`, and no Word/image export IPC.

- [ ] **Step 1: Extend the branding test before changing product files**

Replace `tests/unit/smoke.test.ts` with:

```ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import pkg from '../../package.json'

const builder = readFileSync('electron-builder.yml', 'utf8')

it('uses the DraftMD package identity', () => {
  expect(pkg.name).toBe('draftmd')
  expect(pkg.productName).toBe('DraftMD')
  expect(pkg.description).toContain('AI Markdown')
})

it('ships only macOS Universal artifacts', () => {
  expect(builder).toContain('appId: app.draftmd.desktop')
  expect(builder).not.toContain('\nwin:')
  expect(builder).not.toContain('\nlinux:')
  expect(builder).not.toContain('\nnsis:')
})
```

Run: `npm run test -- tests/unit/smoke.test.ts`

Expected: FAIL on package identity and non-mac build sections.

- [ ] **Step 2: Update package metadata and supported runtime**

Set exact package fields and scripts:

```json
{
  "name": "draftmd",
  "productName": "DraftMD",
  "version": "0.1.0",
  "description": "The open-source macOS AI Markdown editor",
  "license": "MIT",
  "engines": { "node": ">=22.12.0" },
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "typecheck": "tsc -b --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:integration": "vitest run --config vitest.integration.config.ts",
    "test:e2e": "playwright test",
    "check:theme-colors": "node scripts/check-theme-colors.mjs",
    "dist:mac": "electron-vite build && electron-builder --mac --universal"
  }
}
```

Remove `docx` from dependencies. Upgrade only the build/runtime stack in this task: `electron@^44.1.0`, `electron-vite@^5.0.0`, `vite@^7.1.3`, `typescript@^7.0.2`, `electron-builder@^26.15.3`.

- [ ] **Step 3: Make electron-builder macOS-only**

Use:

```yaml
appId: app.draftmd.desktop
productName: DraftMD
copyright: Copyright © 2026 DraftMD contributors

directories:
  output: release
  buildResources: resources

files:
  - dist/**/*

extraResources:
  - from: resources/templates
    to: templates
  - from: resources/demo
    to: demo

afterPack: ./scripts/afterPack.js

fileAssociations:
  - ext: md
    name: Markdown Document
    role: Editor
    mimeType: text/markdown
  - ext: markdown
    name: Markdown Document
    role: Editor
    mimeType: text/markdown

mac:
  target:
    - dmg
    - zip
  minimumSystemVersion: '13.0.0'
  category: public.app-category.productivity
  icon: resources/icon.icns
  hardenedRuntime: true
  gatekeeperAssess: false
  entitlements: resources/entitlements.mac.plist
  entitlementsInherit: resources/entitlements.mac.plist
  notarize: true
```

- [ ] **Step 4: Remove deferred user-facing features**

Delete the DOCX/image export imports, IPC handlers, menu entries, preload methods, renderer event handlers, and dependencies. Remove “New Window” from the menu; retain the internal ability to create a replacement window on macOS activation and to route an already-open document to its window. Remove custom-theme import UI and IPC while retaining built-in themes.

Update visible names from ColaMD to DraftMD in window titles, HTML title, welcome Markdown, READMEs, and startup diagnostics. Preserve the ColaMD attribution in `LICENSE`:

```text
DraftMD includes software derived from ColaMD.
ColaMD copyright © 2024-2026 marswave.ai, licensed under the MIT License.
DraftMD additions copyright © 2026 DraftMD contributors.
```

- [ ] **Step 5: Make release CI macOS-only and Universal**

Replace the build matrix with one `macos-latest` job using Node 24, `npm ci`, all phase gates, and:

```yaml
- name: Build Universal macOS distributables
  run: npm run dist:mac
  env:
    CSC_LINK: ${{ secrets.CSC_LINK }}
    CSC_KEY_PASSWORD: ${{ secrets.CSC_KEY_PASSWORD }}
    APPLE_ID: ${{ secrets.APPLE_ID }}
    APPLE_APP_SPECIFIC_PASSWORD: ${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }}
    APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
```

Upload only `.dmg`, `.zip`, and update metadata.

- [ ] **Step 6: Run product identity gates**

Run:

```bash
npm install
npm run test -- tests/unit/smoke.test.ts
npm run typecheck
npm run build
npm run check:theme-colors
```

Expected: all commands exit 0 and the smoke test reports 2 passed tests.

- [ ] **Step 7: Commit when authorized**

```bash
git add package.json package-lock.json electron-builder.yml .github src README.md README_CN.md LICENSE tests

git commit -m "feat: establish macOS-only DraftMD product"
```

---

### Task 3: Add a Shared Chinese/English Message Catalog

**Files:**
- Create: `src/shared/i18n/messages.ts`
- Create: `src/shared/i18n/index.ts`
- Create: `tests/unit/i18n/i18n.test.ts`
- Modify: `tsconfig.main.json`
- Modify: `tsconfig.preload.json`
- Modify: `tsconfig.renderer.json`
- Modify: `src/main/index.ts`
- Modify: `src/renderer/main.ts`
- Modify: `src/renderer/editor/editor.ts`
- Modify: `src/renderer/index.html`

**Interfaces:**
- Produces: `Locale = 'zh-CN' | 'en'`, `MessageKey`, `detectLocale(language)`, `t(locale, key, vars?)`, and `assertCatalogParity()`.
- Later tasks consume `t()` for every provider, Agent, settings, task, Diff, and recovery string.

- [ ] **Step 1: Write catalog parity and formatting tests**

Create `tests/unit/i18n/i18n.test.ts`:

```ts
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
})
```

Run: `npm run test -- tests/unit/i18n/i18n.test.ts`

Expected: FAIL because `src/shared/i18n` does not exist.

- [ ] **Step 2: Define initial complete catalogs**

`messages.ts` starts with keys for all existing visible UI plus planned top-level surfaces:

```ts
export const messages = {
  en: {
    'app.name': 'DraftMD',
    'document.untitled': 'Untitled',
    'document.edited': 'Edited',
    'files.title': 'Files',
    'files.outline': 'Outline',
    'files.count': '{count} files',
    'editor.source': 'Switch to Markdown source',
    'editor.visual': 'Switch to visual editor',
    'agent.configure': 'Configure a model to start collaborating',
    'agent.stop': 'Stop task',
    'common.cancel': 'Cancel',
    'common.save': 'Save',
  },
  'zh-CN': {
    'app.name': 'DraftMD',
    'document.untitled': '未命名',
    'document.edited': '已编辑',
    'files.title': '文件',
    'files.outline': '大纲',
    'files.count': '{count} 个文件',
    'editor.source': '切换 Markdown 源码',
    'editor.visual': '切换回所见即所得',
    'agent.configure': '配置模型后开始协作',
    'agent.stop': '停止任务',
    'common.cancel': '取消',
    'common.save': '保存',
  },
} as const
```

`MessageKey` is `keyof typeof messages.en`. `assertCatalogParity()` compares sorted keys and throws with missing/extra names. `t()` replaces `{name}` from a `Record<string, string | number>` and throws in tests for an missing interpolation value.

- [ ] **Step 3: Make shared source importable from all targets**

Change each `tsconfig.*.json` `rootDir` to `src` and include both its target directory plus `src/shared/**/*`. Confirm electron-vite output paths remain unchanged.

- [ ] **Step 4: Replace existing hard-coded UI strings**

Main process determines locale from saved setting, falling back to `app.getLocale()`. Renderer receives locale in an `app-bootstrap` payload and sets `document.documentElement.lang`. Replace existing menu, titlebar, file panel, export, search, font, conflict, update, and welcome strings with catalog keys. HTML initial labels use neutral English only until bootstrap, then `applyStaticMessages()` replaces them before editor focus.

- [ ] **Step 5: Run parity, type, and visual smoke gates**

Run:

```bash
npm run test -- tests/unit/i18n/i18n.test.ts
npm run typecheck
npm run build
```

Expected: parity test 6/6 passes; TypeScript prevents a missing/unknown key; build exits 0.

- [ ] **Step 6: Commit when authorized**

```bash
git add src/shared src/main src/renderer tsconfig*.json tests/unit/i18n

git commit -m "feat: add bilingual message catalog"
```

---

### Task 4: Define Validated Shared IPC Contracts

**Files:**
- Create: `src/shared/contracts/app.ts`
- Create: `src/shared/contracts/document.ts`
- Create: `src/shared/contracts/ipc.ts`
- Create: `src/shared/contracts/index.ts`
- Create: `tests/unit/contracts/ipc.test.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/env.d.ts`

**Interfaces:**
- Produces: `AppBootstrapSchema`, `FileOpenedSchema`, `DocumentSnapshotSchema`, `SiblingFileSchema`, `IpcInvokeMap`, and typed `DraftMDAPI`.
- Main-process handlers in Task 5 and every later phase validate inputs/outputs against these schemas.

- [ ] **Step 1: Write contract rejection tests**

```ts
import { expect, it } from 'vitest'
import { FileOpenedSchema, DocumentSnapshotSchema } from '../../../src/shared/contracts'

it('rejects a file-open payload with executable content fields', () => {
  expect(() => FileOpenedSchema.parse({ path: '/tmp/a.md', content: '# A', script: 'x' })).toThrow()
})

it('requires a finite non-negative document revision', () => {
  expect(() => DocumentSnapshotSchema.parse({ dirty: false, content: '', revision: -1 })).toThrow()
})
```

Use `.strict()` on object schemas. Run the file and expect module-not-found failure.

- [ ] **Step 2: Implement serializable schemas**

Use Zod schemas with exact fields:

```ts
export const DocumentSnapshotSchema = z.object({
  dirty: z.boolean(),
  content: z.string(),
  revision: z.number().int().nonnegative(),
}).strict()

export const FileOpenedSchema = z.object({
  path: z.string().nullable(),
  content: z.string(),
  version: z.string().nullable(),
}).strict()
```

`SiblingFileSchema.kind` is `file | directory | parent`; `AppBootstrapSchema` carries `{ locale, platform: 'darwin', appVersion }`.

- [ ] **Step 3: Define the bridge as a typed allowlist**

Create `IpcInvokeMap` whose keys are explicit channels and whose values define `args` tuples and result types. Refactor preload exports to `DraftMDAPI`; no method accepts `unknown` beyond the preload validation boundary. Every listener registration returns an unsubscribe function that calls `ipcRenderer.removeListener`.

- [ ] **Step 4: Validate both directions**

Preload parses renderer arguments before `invoke` and parses main results before returning. Event payloads are parsed before user callbacks. Invalid payloads are discarded and logged as channel names only, never content.

- [ ] **Step 5: Verify contracts**

Run:

```bash
npm run test -- tests/unit/contracts/ipc.test.ts
npm run typecheck
npm run build
```

Expected: tests pass; renderer compiles only against `window.draftmd`, not `window.electronAPI`.

- [ ] **Step 6: Commit when authorized**

```bash
git add src/shared/contracts src/preload src/renderer/env.d.ts tests/unit/contracts

git commit -m "refactor: validate renderer IPC contracts"
```

---

### Task 5: Split the Main Process into Focused Services

**Files:**
- Create: `src/main/app/window-manager.ts`
- Create: `src/main/app/menu.ts`
- Create: `src/main/app/ipc.ts`
- Create: `src/main/documents/document-service.ts`
- Create: `src/main/documents/image-paths.ts`
- Create: `src/main/documents/recent-store.ts`
- Create: `src/main/documents/watch-service.ts`
- Move: `src/main/docx-export.ts` removed in Task 2
- Move: PDF/HTML logic into `src/main/export/pdf.ts`, `src/main/export/html.ts`
- Modify: `src/main/index.ts`
- Create: `tests/unit/documents/image-paths.test.ts`
- Create: `tests/unit/documents/recent-store.test.ts`

**Interfaces:**
- Produces: `createWindowManager(deps)`, `createDocumentService(deps)`, `createWatchService(deps)`, `buildApplicationMenu(deps)`, and `registerIpcHandlers(deps)`.
- `src/main/index.ts` becomes a composition root under 180 lines.

- [ ] **Step 1: Pin existing pure behavior with characterization tests**

Move image URL conversion into exported pure functions and test both directions:

```ts
it('round-trips a relative image path without leaking file URLs', () => {
  const shown = resolveImagePaths('![x](./img/a.png)', '/work/spec.md')
  expect(shown).toContain('file://')
  expect(restoreImagePaths(shown, '/work/spec.md')).toBe('![x](./img/a.png)')
})
```

Test recent files: max 10, deduplicate while moving newest to front, and ignore malformed JSON. Run tests against extracted functions before changing behavior.

- [ ] **Step 2: Extract document and watcher services without behavior changes**

`DocumentService` owns open/load/save/save-as and image-path conversions. `WatchService` owns `FSWatcher`, internal-write suppression, debouncing, and external conflict events. Both receive filesystem functions through constructors so tests can use temp directories or fakes.

Use exact shape:

```ts
export interface DocumentService {
  load(path: string): Promise<{ content: string; version: string }>
  save(input: { path: string; content: string; expectedVersion?: string }): Promise<{ path: string; version: string }>
}
```

The Phase 1 version may compute `version` as SHA-256 of disk bytes; Phase 2 reuses it for Agent writes.

- [ ] **Step 3: Extract window lifecycle and menu**

`WindowManager` owns `WindowState`, BrowserWindow creation, dirty-close confirmation, and focus of an already-open path. `menu.ts` only builds bilingual menu templates and calls injected callbacks. Do not expose a New Window menu entry.

- [ ] **Step 4: Extract IPC registration**

Each handler obtains its BrowserWindow from `event.sender`, parses arguments using Task 4 contracts, delegates to one service, parses output, and never contains document business logic.

- [ ] **Step 5: Reduce the composition root**

`src/main/index.ts` should only initialize paths/config, construct services, register app lifecycle events, register IPC, and start updater wiring. Verify with:

```bash
test "$(wc -l < src/main/index.ts)" -le 180
```

Expected: exit 0.

- [ ] **Step 6: Run regression gates**

Run:

```bash
npm run test -- tests/unit/documents
npm run typecheck
npm run build
npm run check:theme-colors
git diff --check
```

Expected: all pass. Manually launch `npm run dev` and verify open, edit, autosave, source toggle, external update, files/outline, Mermaid, LaTeX, HTML, and PDF.

- [ ] **Step 7: Commit when authorized**

```bash
git add src/main src/shared src/preload tests/unit/documents

git commit -m "refactor: split DraftMD desktop services"
```

---

### Task 6: Split Renderer Coordination and Add a Foundation E2E Smoke Test

**Files:**
- Create: `src/renderer/app/document-controller.ts`
- Create: `src/renderer/app/file-panel-controller.ts`
- Create: `src/renderer/app/source-mode-controller.ts`
- Create: `src/renderer/app/bootstrap.ts`
- Modify: `src/renderer/main.ts`
- Create: `playwright.config.ts`
- Create: `tests/e2e/foundation.spec.ts`
- Create: `tests/helpers/electron-app.ts`

**Interfaces:**
- Produces: `DocumentController`, `FilePanelController`, and `SourceModeController`; renderer `main.ts` remains a composition root under 140 lines.
- Provides the reusable Electron launch helper consumed by Phase 5 E2E tests.

- [ ] **Step 1: Write the Electron smoke test**

```ts
import { expect, test } from '@playwright/test'
import { launchDraftMD } from '../helpers/electron-app'

test('opens as DraftMD and edits without a model', async () => {
  const app = await launchDraftMD()
  const page = await app.firstWindow()
  await expect(page).toHaveTitle(/DraftMD/)
  await expect(page.locator('#editor')).toBeVisible()
  await expect(page.locator('#source-toggle-btn')).toHaveAccessibleName(/Markdown|源码/)
  await app.close()
})
```

Run: `npm run test:e2e -- tests/e2e/foundation.spec.ts`

Expected: FAIL because config/helper does not exist.

- [ ] **Step 2: Add deterministic Electron launch infrastructure**

`launchDraftMD()` runs `npm run build` before the suite, launches Electron with the built main entry and a temporary `DRAFTMD_TEST_USER_DATA` directory, disables updates, and returns cleanup that removes the temp directory. Configure one worker and retain trace on first retry.

- [ ] **Step 3: Extract renderer controllers**

Move autosave/revision/dirty behavior into `DocumentController`, panel rendering into `FilePanelController`, and WYSIWYG/source synchronization into `SourceModeController`. Controllers accept DOM elements and `DraftMDAPI`; they do not query arbitrary global selectors internally.

Exact document interface:

```ts
export interface DocumentController {
  currentPath(): string | null
  currentContent(): string
  revision(): number
  flushSave(): Promise<boolean>
  applyDiskContent(input: FileOpened): void
  dispose(): void
}
```

- [ ] **Step 4: Keep renderer composition small**

`bootstrap.ts` applies locale, constructs editor and controllers, subscribes to bridge events, and returns a disposer. `main.ts` only imports CSS and calls `bootstrapRenderer()` on DOM ready.

Run:

```bash
test "$(wc -l < src/renderer/main.ts)" -le 140
npm run typecheck
npm run build
```

Expected: all exit 0.

- [ ] **Step 5: Run the smoke test and foundation gate**

Run:

```bash
npm run test
npm run test:e2e -- tests/e2e/foundation.spec.ts
npm run build
npm run check:theme-colors
git diff --check
```

Expected: all unit tests and the E2E smoke test pass.

- [ ] **Step 6: Commit when authorized**

```bash
git add src/renderer tests/e2e tests/helpers playwright.config.ts

git commit -m "refactor: establish tested renderer foundation"
```
