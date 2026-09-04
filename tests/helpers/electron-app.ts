import { _electron as electron, type ElectronApplication, type Page } from 'playwright'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

const projectRoot = process.cwd()
const mainEntry = join(projectRoot, 'dist/main/index.js')



export async function findMatchingWindow<PageType>(
  windows: () => readonly PageType[],
  predicate: (page: PageType) => boolean | Promise<boolean>,
  options: { attemptTimeoutMs?: number; deadlineMs?: number; pollMs?: number } = {},
): Promise<PageType> {
  const attemptTimeoutMs = options.attemptTimeoutMs ?? 100
  const deadline = Date.now() + (options.deadlineMs ?? 10_000)
  const pollMs = options.pollMs ?? 50
  while (Date.now() < deadline) {
    for (const page of windows()) {
      const matched = await Promise.race([
        Promise.resolve(predicate(page)).catch(() => false),
        new Promise<false>((resolve) => setTimeout(() => resolve(false), attemptTimeoutMs)),
      ])
      if (matched) return page
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs))
  }
  throw new Error('Timed out waiting for a matching DraftMD window')
}

export function resolveTestDocumentPath(userDataPath: string, documentName: string): string {
  if (!documentName || isAbsolute(documentName) || documentName === '.' || documentName === '..' || documentName.includes('/') || documentName.includes('\\')) {
    throw new Error('documentName must be a plain filename')
  }
  const root = resolve(userDataPath)
  const candidate = resolve(root, documentName)
  const inside = relative(root, candidate)
  if (!inside || inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) {
    throw new Error('documentName must remain inside test userData')
  }
  return candidate
}


export function resolveTestLaunchDocument(userDataPath: string, input: {
  documentName?: string
  documentPath?: string
  tempRoot: string
}): string | null {
  if (input.documentName && input.documentPath) throw new Error('Provide only one test launch document')
  if (input.documentName) return resolveTestDocumentPath(userDataPath, input.documentName)
  if (!input.documentPath) return null
  if (!isAbsolute(input.documentPath) || !/\.(?:md|markdown)$/i.test(input.documentPath)) {
    throw new Error('documentPath must be an absolute Markdown path')
  }
  const path = resolve(input.documentPath)
  const inside = relative(resolve(input.tempRoot), path)
  if (!inside || inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) {
    throw new Error('documentPath must remain inside the test temp root')
  }
  return path
}

export interface LaunchDraftMDOptions {
  userDataPath?: string
  documentName?: string
  locale?: 'zh-CN' | 'en'
  onboardingCompleted?: boolean
  prepare?(directory: string): Promise<void>
  documentPath?: string
  env?: Record<string, string>
}

export interface DraftMDTestApplication extends ElectronApplication {
  readonly userDataPath: string
  windowMatching(predicate: (page: Page) => boolean | Promise<boolean>): Promise<Page>
  cleanup(): Promise<void>
}

export async function launchDraftMD(options: LaunchDraftMDOptions = {}): Promise<DraftMDTestApplication> {
  const ownsUserData = !options.userDataPath
  const userDataPath = await realpath(options.userDataPath ?? await mkdtemp(join(tmpdir(), 'draftmd-e2e-')))
  let app: ElectronApplication | null = null
  let cleaned = false

  try {
    await options.prepare?.(userDataPath)
    if (options.locale) {
      const { writeFile } = await import('node:fs/promises')
      await writeFile(join(userDataPath, 'settings.json'), JSON.stringify({ locale: options.locale }))
    }
    const args = [mainEntry]
    const launchDocument = resolveTestLaunchDocument(userDataPath, {
      documentName: options.documentName, documentPath: options.documentPath, tempRoot: tmpdir(),
    })
    if (launchDocument) args.push(launchDocument)
    app = await electron.launch({
      executablePath: require('electron') as string,
      args,
      cwd: projectRoot,
      env: {
        ...process.env,
        DRAFTMD_TEST_USER_DATA: userDataPath,
        NODE_ENV: 'test',
        ...options.env,
      },
    })
    const windowMatching = async (predicate: (page: Page) => boolean | Promise<boolean>): Promise<Page> => {
      const page = await findMatchingWindow(() => app!.windows(), predicate)
      if (options.onboardingCompleted !== false) {
        const dialog = page.locator('#onboarding-dialog')
        if (await dialog.isVisible().catch(() => false)) {
          await dialog.getByRole('button', { name: /Skip guide|跳过指南/ }).click()
        }
      }
      return page
    }

    const cleanup = async (): Promise<void> => {
      if (cleaned) return
      cleaned = true
      if (app) {
        try {
          await app.evaluate(({ app: electronApp }) => {
            const fallback = setTimeout(() => electronApp.exit(0), 1_000)
            const clearFallback = (): void => clearTimeout(fallback)
            electronApp.once('will-quit', clearFallback)
            fallback.unref()
          })
          await app.close()
        } catch {
          // The scheduled app.exit(0) fallback may close the transport first.
        }
      }
      if (ownsUserData) await rm(userDataPath, { recursive: true, force: true })
    }

    return Object.assign(app, { userDataPath, windowMatching, cleanup })
  } catch (error) {
    if (app) await app.close().catch(() => {})
    if (ownsUserData) await rm(userDataPath, { recursive: true, force: true })
    throw error
  }
}
