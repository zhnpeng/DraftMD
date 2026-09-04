const { execFileSync } = require('node:child_process')
const { existsSync, readFileSync, readdirSync } = require('node:fs')
const { join } = require('node:path')
const { tmpdir } = require('node:os')
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs')
const { validatePackagedNativeModules } = require('./afterPack.js')

function architectures(file) {
  return execFileSync('lipo', ['-archs', file], { encoding: 'utf8' }).trim().split(/\s+/).map((arch) => arch === 'x86_64' ? 'x64' : arch)
}

function symlinks(root) {
  const found = []
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const target = join(directory, entry.name)
      if (entry.isSymbolicLink()) found.push(target)
      else if (entry.isDirectory()) visit(target)
    }
  }
  visit(root)
  return found
}

function verifyUniversal(root = process.cwd()) {
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
  const app = join(root, 'release/mac-universal/DraftMD.app')
  const executable = join(app, 'Contents/MacOS/DraftMD')
  for (const path of [
    app,
    join(root, `release/DraftMD-${version}-universal.dmg`),
    join(root, `release/DraftMD-${version}-universal-mac.zip`),
  ]) if (!existsSync(path)) throw new Error(`Missing Universal artifact: ${path}`)
  const appArchitectures = architectures(executable).sort()
  if (appArchitectures.join(' ') !== 'arm64 x64') throw new Error(`Universal executable has wrong architectures: ${appArchitectures.join(' ')}`)
  validatePackagedNativeModules({ appPath: app, arch: 'universal' })
  const runtime = join(app, 'Contents/Resources/node_modules')
  const links = symlinks(runtime)
  if (links.length) throw new Error(`Packaged runtime contains symlink: ${links[0]}`)
  const runtimeRoots = readdirSync(runtime).sort()
  const expectedRoots = ['@napi-rs', 'better-sqlite3']
  if (runtimeRoots.join('\0') !== expectedRoots.join('\0')) {
    throw new Error(`Unexpected packaged runtime roots: ${runtimeRoots.join(', ')}`)
  }

  const directory = mkdtempSync(join(tmpdir(), 'draftmd-universal-verify-'))
  const probe = join(directory, 'probe.cjs')
  writeFileSync(probe, `
    require('@napi-rs/keyring')
    const Database = require('better-sqlite3')
    const database = new Database(':memory:')
    if (database.prepare('select 1 as value').get().value !== 1) process.exit(2)
    database.close()
  `)
  try {
    execFileSync(executable, [probe], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_PATH: runtime },
      stdio: 'pipe',
    })
  } finally { rmSync(directory, { recursive: true, force: true }) }
  return { app, appArchitectures, runtime }
}

module.exports = { architectures, symlinks, verifyUniversal }

if (require.main === module) {
  const result = verifyUniversal()
  console.log(`Verified unsigned Universal candidate: ${result.app}`)
}
