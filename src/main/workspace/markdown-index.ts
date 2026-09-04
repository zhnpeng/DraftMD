import { opendir, readFile, stat } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import type { WorkspaceRoot } from './path-guard'

const SKIPPED_DIRECTORIES = new Set(['.git', 'node_modules'])
const MAX_FILES = 1_000
const MAX_MATCHES = 50

export interface MarkdownFileInfo {
  path: string
  size: number
  mtimeMs: number
}

export interface SearchMatch {
  path: string
  line: number
  headingPath: string[]
  context: string[]
}

function isMarkdownFile(name: string): boolean {
  const lower = name.toLowerCase()
  return !name.startsWith('.') && (lower.endsWith('.md') || lower.endsWith('.markdown'))
}

function toLogicalPath(root: string, absolutePath: string): string {
  return relative(root, absolutePath).split(sep).join('/')
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('The operation was aborted', 'AbortError')
}

async function collectMarkdownPaths(root: WorkspaceRoot, signal?: AbortSignal): Promise<string[]> {
  const paths: string[] = []
  const directories = [root.canonicalPath]

  while (directories.length > 0) {
    throwIfAborted(signal)
    const directory = directories.pop()!
    const entries = []
    for await (const entry of await opendir(directory)) entries.push(entry)
    entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)

    for (const entry of entries) {
      throwIfAborted(signal)
      if (entry.name.startsWith('.')) continue
      const absolutePath = join(directory, entry.name)
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) directories.push(absolutePath)
      } else if (entry.isFile() && isMarkdownFile(entry.name)) {
        paths.push(absolutePath)
      }
    }
  }

  return paths.sort((left, right) => {
    const leftPath = toLogicalPath(root.canonicalPath, left)
    const rightPath = toLogicalPath(root.canonicalPath, right)
    return leftPath < rightPath ? -1 : leftPath > rightPath ? 1 : 0
  })
}

export async function listMarkdownFiles(root: WorkspaceRoot, signal?: AbortSignal): Promise<MarkdownFileInfo[]> {
  const paths = (await collectMarkdownPaths(root, signal)).slice(0, MAX_FILES)
  return Promise.all(paths.map(async (absolutePath) => {
    throwIfAborted(signal)
    const metadata = await stat(absolutePath)
    return {
      path: toLogicalPath(root.canonicalPath, absolutePath),
      size: metadata.size,
      mtimeMs: metadata.mtimeMs,
    }
  }))
}

function headingDepth(line: string): { depth: number; text: string } | null {
  const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line)
  if (!match) return null
  return { depth: match[1].length, text: match[2] }
}

export async function searchMarkdownFiles(
  root: WorkspaceRoot,
  query: string,
  limit = MAX_MATCHES,
  signal?: AbortSignal,
): Promise<SearchMatch[]> {
  throwIfAborted(signal)
  const boundedLimit = Math.max(0, Math.min(MAX_MATCHES, Math.floor(limit)))
  if (boundedLimit === 0 || query.length === 0) return []
  const needle = query.toLocaleLowerCase()
  const matches: SearchMatch[] = []

  for (const absolutePath of await collectMarkdownPaths(root, signal)) {
    throwIfAborted(signal)
    const lines = (await readFile(absolutePath, 'utf8')).split(/\r?\n/)
    const headings: string[] = []

    for (let index = 0; index < lines.length; index += 1) {
      throwIfAborted(signal)
      const heading = headingDepth(lines[index])
      if (heading) {
        headings.length = heading.depth - 1
        headings[heading.depth - 1] = heading.text
      }
      if (!lines[index].toLocaleLowerCase().includes(needle)) continue

      matches.push({
        path: toLogicalPath(root.canonicalPath, absolutePath),
        line: index + 1,
        headingPath: headings.filter((value): value is string => value !== undefined),
        context: lines.slice(Math.max(0, index - 2), index + 3),
      })
      if (matches.length >= boundedLimit) return matches
    }
  }

  return matches
}
