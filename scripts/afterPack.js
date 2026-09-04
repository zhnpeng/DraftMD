const { execFileSync } = require('node:child_process')
const { existsSync } = require('node:fs')
const path = require('node:path')

const ARCH_NAMES = { 1: 'x64', 3: 'arm64', 4: 'universal', x64: 'x64', arm64: 'arm64', universal: 'universal' }

function normalizeArchitecture(arch) { return arch === 'x86_64' ? 'x64' : arch }

function lipoArchitectures(file) {
  return execFileSync('lipo', ['-archs', file], { encoding: 'utf8' }).trim().split(/\s+/).filter(Boolean).map(normalizeArchitecture)
}

function validatePackagedNativeModules(input) {
  const arch = ARCH_NAMES[input.arch]
  if (!arch) throw new Error(`Unsupported packaged architecture: ${input.arch}`)
  const exists = input.exists ?? existsSync
  const architectures = input.architectures ?? lipoArchitectures
  const root = path.join(input.appPath, 'Contents/Resources/node_modules')
  const architecturesToCheck = arch === 'universal' ? ['arm64', 'x64'] : [arch]
  const required = [
    path.join(root, 'better-sqlite3/lib/index.js'),
    ...architecturesToCheck.map((item) => path.join(root, `better-sqlite3/prebuilds/darwin-${item}.node`)),
    path.join(root, '@napi-rs/keyring/index.js'),
    ...architecturesToCheck.map((item) => path.join(root, `@napi-rs/keyring-darwin-${item}/keyring.darwin-${item}.node`)),
  ]
  for (const file of required) {
    if (!exists(file)) throw new Error(`Missing packaged native module path: ${file}`)
  }
  for (const file of required.filter((candidate) => candidate.endsWith('.node'))) {
    const expected = file.includes('arm64') ? 'arm64' : 'x64'
    const found = architectures(file).map(normalizeArchitecture)
    if (!found.includes(expected)) throw new Error(`Native module expected ${expected} but found ${found.join(' ') || 'no architectures'}: ${file}`)
  }
  return required
}

async function afterPack(context) {
  if (process.platform !== 'darwin') return
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  const arch = ARCH_NAMES[context.arch] ?? (context.appOutDir.includes('mac-universal') ? 'universal' : undefined)
  validatePackagedNativeModules({ appPath, arch })
  console.log(`Validated packaged native modules for ${arch}: ${appPath}`)
  execFileSync('xattr', ['-cr', appPath], { stdio: 'inherit' })
}

exports.validatePackagedNativeModules = validatePackagedNativeModules
exports.default = afterPack
