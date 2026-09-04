import { createHash } from 'node:crypto'
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'

function outputArgument(argv) {
  const index = argv.indexOf('--output')
  const output = index >= 0 ? argv[index + 1] : null
  if (!output || !isAbsolute(output)) throw new Error('Usage: generate-performance-fixtures.mjs --output <absolute-empty-directory>')
  return output
}

async function requireEmptyDirectory(path) {
  await mkdir(path, { recursive: true })
  if ((await readdir(path)).length !== 0) throw new Error('Performance fixture output directory must be empty')
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

const output = outputArgument(process.argv.slice(2))
await requireEmptyDirectory(output)
const workspace = join(output, 'workspace')
await mkdir(workspace)

const aggregate = createHash('sha256')
const writes = []
for (let index = 0; index < 1_000; index += 1) {
  const number = String(index).padStart(4, '0')
  const group = `group-${String(Math.floor(index / 100)).padStart(2, '0')}`
  const relativePath = `${group}/docs/note-${number}.md`
  const content = `# Note ${number}\n\nDeterministic DraftMD performance fixture.\n\nDRAFTMD_NEEDLE_${number}\n`
  aggregate.update(relativePath).update('\0').update(content).update('\0')
  const path = join(workspace, relativePath)
  writes.push(mkdir(dirname(path), { recursive: true }).then(() => writeFile(path, content)))
}
await Promise.all(writes)

const mixedBlock = `# Large DraftMD Fixture\n\n## Structured content\n\n| Column A | Column B |\n| --- | --- |\n| alpha | beta |\n\n\`\`\`typescript\nconst fixture = 'deterministic'\n\`\`\`\n\n\`\`\`mermaid\ngraph TD\n  A[Draft] --> B[Review]\n\`\`\`\n\n$$\nE = mc^2\n$$\n\nPlain editing paragraph for event-loop measurements.\n\n`
const targetBytes = 5 * 1024 * 1024
const repetitions = Math.ceil(targetBytes / Buffer.byteLength(mixedBlock))
const largeBytes = Buffer.from(mixedBlock.repeat(repetitions), 'utf8').subarray(0, targetBytes)
await writeFile(join(output, 'large.md'), largeBytes)

const manifest = {
  files: 1_000,
  largeBytes: largeBytes.byteLength,
  workspaceSha256: aggregate.digest('hex'),
  largeSha256: sha256(largeBytes),
}
await writeFile(join(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
process.stdout.write(`${JSON.stringify(manifest)}\n`)
