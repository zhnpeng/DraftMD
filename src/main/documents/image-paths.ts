import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { fromMarkdown } from 'mdast-util-from-markdown'
import type { Nodes } from 'mdast'

const MARKDOWN_ESCAPABLE = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/

function unescapeMarkdownDestination(value: string): string {
  let result = ''
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '\\' && index + 1 < value.length && MARKDOWN_ESCAPABLE.test(value[index + 1])) index += 1
    result += value[index]
  }
  return result
}

function hasNonFileScheme(value: string): boolean {
  if (value.startsWith('//')) return true
  const scheme = value.match(/^([A-Za-z][A-Za-z0-9+.-]*):/)?.[1]
  if (!scheme || /^[A-Za-z]:/.test(value)) return false
  return scheme.toLowerCase() !== 'file'
}

function localImageUrl(src: string, dir: string, markdown = true): string {
  const value = markdown ? unescapeMarkdownDestination(src.trim()) : src.trim()
  if (!value || /^file:/i.test(value) || hasNonFileScheme(value)) return src
  return pathToFileURL(isAbsolute(value) ? value : resolve(dir, value)).href
}


type MarkdownImage = {
  start: number
  end: number
  destination: string
  destinationStart: number
  destinationEnd: number
  angled: boolean
}

function findUnescaped(value: string, start: number, target: string): number {
  for (let index = start; index < value.length; index += 1) {
    if (value[index] === '\\') { index += 1; continue }
    if (value[index] === target) return index
  }
  return -1
}

function markdownImages(content: string): MarkdownImage[] {
  const images: MarkdownImage[] = []
  const opener = /!\[[^\]]*\]\(/g
  for (let match = opener.exec(content); match; match = opener.exec(content)) {
    const destinationStart = opener.lastIndex
    if (content[destinationStart] === '<') {
      const closeAngle = findUnescaped(content, destinationStart + 1, '>')
      if (closeAngle < 0) continue
      const closeParen = findUnescaped(content, closeAngle + 1, ')')
      if (closeParen < 0) continue
      images.push({
        start: match.index, end: closeParen + 1,
        destination: content.slice(destinationStart + 1, closeAngle),
        destinationStart: destinationStart + 1, destinationEnd: closeAngle, angled: true,
      })
      opener.lastIndex = closeParen + 1
      continue
    }

    let depth = 0
    let destinationEnd = destinationStart
    while (destinationEnd < content.length) {
      const char = content[destinationEnd]
      if (char === '\\' && destinationEnd + 1 < content.length) { destinationEnd += 2; continue }
      if (/\s/.test(char) && depth === 0) break
      if (char === '(') depth += 1
      else if (char === ')') {
        if (depth === 0) break
        depth -= 1
      }
      destinationEnd += 1
    }
    let closeParen = destinationEnd
    let quote: string | null = null
    while (closeParen < content.length) {
      const char = content[closeParen]
      if (char === '\\' && closeParen + 1 < content.length) { closeParen += 2; continue }
      if (quote) {
        if (char === quote) quote = null
      } else if (char === '"' || char === "'") quote = char
      else if (char === ')') break
      closeParen += 1
    }
    if (closeParen >= content.length) continue
    images.push({
      start: match.index, end: closeParen + 1,
      destination: content.slice(destinationStart, destinationEnd),
      destinationStart, destinationEnd, angled: false,
    })
    opener.lastIndex = closeParen + 1
  }
  return images
}

type ProtectedRange = { start: number; end: number }
type AstNode = Nodes & { children?: AstNode[] }

const PARSE_FAILURE_DIAGNOSTIC = '[image-paths] Markdown parsing failed; image paths left unchanged'

function protectedMarkdownRanges(content: string): ProtectedRange[] | null {
  const ranges: ProtectedRange[] = []
  try {
    visit(fromMarkdown(content) as AstNode)
    return ranges
  } catch {
    console.error(PARSE_FAILURE_DIAGNOSTIC)
    return null
  }

  function visit(node: AstNode): void {
    if (node.type === 'code' || node.type === 'inlineCode') {
      const start = node.position?.start.offset
      const end = node.position?.end.offset
      if (start === undefined || end === undefined) throw new Error('Markdown node is missing offsets')
      ranges.push({ start, end })
    }
    for (const child of node.children ?? []) visit(child)
  }
}

type Replacement = { start: number; end: number; value: string }

function rangeContaining(ranges: ProtectedRange[], start: number, end: number): ProtectedRange | undefined {
  return ranges.find((range) => start >= range.start && end <= range.end)
}

function applyReplacements(content: string, replacements: Replacement[]): string {
  let result = content
  for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
    result = result.slice(0, replacement.start) + replacement.value + result.slice(replacement.end)
  }
  return result
}

function imageReplacements(
  content: string,
  protectedRanges: ProtectedRange[],
  transform: (image: MarkdownImage) => string,
): Replacement[] {
  return markdownImages(content)
    .filter((image) => !rangeContaining(
      protectedRanges,
      image.destinationStart,
      image.destinationEnd,
    ))
    .map((image) => ({
      start: image.destinationStart,
      end: image.destinationEnd,
      value: transform(image),
    }))
}

function htmlImageReplacements(
  content: string,
  protectedRanges: ProtectedRange[],
  transform: (src: string) => string,
  fileOnly: boolean,
): Replacement[] {
  const replacements: Replacement[] = []
  const element = /<img\b[^>]*>/gi
  for (let match = element.exec(content); match; match = element.exec(content)) {
    const elementStart = match.index
    const elementEnd = elementStart + match[0].length
    if (rangeContaining(protectedRanges, elementStart, elementEnd)) continue
    const src = /\bsrc\s*=\s*(["'])([^"']+)\1/i.exec(match[0])
    if (!src || (fileOnly && !/^file:/i.test(src[2]))) continue
    const valueStart = elementStart + src.index + src[0].indexOf(src[2])
    replacements.push({ start: valueStart, end: valueStart + src[2].length, value: transform(src[2]) })
  }
  return replacements
}

function hasImageCandidate(content: string): boolean {
  return content.includes('![') || /<img\b/i.test(content)
}

export function resolveImagePaths(content: string, filePath: string): string {
  if (!hasImageCandidate(content)) return content
  const dir = dirname(filePath)
  const protectedRanges = protectedMarkdownRanges(content)
  if (!protectedRanges) return content
  return applyReplacements(content, [
    ...imageReplacements(content, protectedRanges, (image) => localImageUrl(image.destination, dir)),
    ...htmlImageReplacements(content, protectedRanges, (src) => localImageUrl(src, dir, false), false),
  ])
}

function sourceImageUrl(src: string, dir: string): string {
  const value = src.trim()
  if (!/^file:/i.test(value)) return src
  try {
    const target = fileURLToPath(value)
    const nativeRelative = relative(dir, target)
    // A different Windows drive cannot be represented relative to this document.
    if (isAbsolute(nativeRelative)) return pathToFileURL(target).href
    const portable = nativeRelative.split(sep).join('/')
    if (!portable) return './'
    return portable.startsWith('.') ? portable : `./${portable}`
  } catch {
    return src
  }
}

function escapeMarkdownPath(value: string, angled: boolean): string {
  let result = ''
  for (const char of value) {
    if (char === '\\') result += '\\\\'
    else if (angled ? char === '<' || char === '>' : char === '(' || char === ')') result += `\\${char}`
    else result += char
  }
  return result
}

function serializeMarkdownDestination(value: string, angled = false): string {
  if (!value || hasNonFileScheme(value)) return value
  const useAngles = angled || /\s/.test(value)
  const escaped = escapeMarkdownPath(value, useAngles)
  return useAngles && !angled ? `<${escaped}>` : escaped
}

export function restoreImagePaths(content: string, filePath: string): string {
  if (!hasImageCandidate(content)) return content
  const dir = dirname(filePath)
  const protectedRanges = protectedMarkdownRanges(content)
  if (!protectedRanges) return content
  return applyReplacements(content, [
    ...imageReplacements(content, protectedRanges, (image) => {
      const value = sourceImageUrl(image.destination, dir)
      if (image.angled && value === image.destination) return value
      return serializeMarkdownDestination(value, image.angled)
    }),
    ...htmlImageReplacements(content, protectedRanges, (src) => sourceImageUrl(src, dir), true),
  ])
}
