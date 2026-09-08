const { execFileSync } = require('node:child_process')
const { existsSync, readFileSync } = require('node:fs')
const path = require('node:path')

const ARCH_NAMES = { 1: 'x64', 3: 'arm64', 4: 'universal', x64: 'x64', arm64: 'arm64', universal: 'universal' }

function normalizeArchitecture(arch) { return arch === 'x86_64' ? 'x64' : arch }

function lipoArchitectures(file) {
  return execFileSync('lipo', ['-archs', file], { encoding: 'utf8' }).trim().split(/\s+/).filter(Boolean).map(normalizeArchitecture)
}

function peArchitecture(file, readFile = readFileSync) {
  const bytes = readFile(file)
  if (bytes.length < 0x40 || bytes.toString('ascii', 0, 2) !== 'MZ') throw new Error(`Native module is not a PE binary: ${file}`)
  const headerOffset = bytes.readUInt32LE(0x3c)
  if (headerOffset + 6 > bytes.length || bytes.toString('ascii', headerOffset, headerOffset + 4) !== 'PE\0\0') {
    throw new Error(`Native module has an invalid PE header: ${file}`)
  }
  const machine = bytes.readUInt16LE(headerOffset + 4)
  if (machine === 0x8664) return 'x64'
  if (machine === 0xaa64) return 'arm64'
  return `machine-0x${machine.toString(16)}`
}

function validatePackagedNativeModules(input) {
  const arch = ARCH_NAMES[input.arch]
  if (!arch) throw new Error(`Unsupported packaged architecture: ${input.arch}`)
  const platform = input.platform ?? 'darwin'
  if (platform !== 'darwin' && platform !== 'win32') throw new Error(`Unsupported packaged platform: ${platform}`)
  const exists = input.exists ?? existsSync
  const architectures = input.architectures ?? lipoArchitectures
  const nativeArchitecture = input.nativeArchitecture ?? peArchitecture
  const root = platform === 'darwin'
    ? path.join(input.appPath, 'Contents/Resources/node_modules')
    : path.join(input.appPath, 'resources/node_modules')
  const architecturesToCheck = arch === 'universal' ? ['arm64', 'x64'] : [arch]
  const required = [
    path.join(root, 'better-sqlite3/lib/index.js'),
    ...architecturesToCheck.map((item) => path.join(root, `better-sqlite3/prebuilds/${platform}-${item}.node`)),
    path.join(root, '@napi-rs/keyring/index.js'),
    ...architecturesToCheck.map((item) => platform === 'darwin'
      ? path.join(root, `@napi-rs/keyring-darwin-${item}/keyring.darwin-${item}.node`)
      : path.join(root, `@napi-rs/keyring-win32-${item}-msvc/keyring.win32-${item}-msvc.node`)),
  ]
  for (const file of required) {
    if (!exists(file)) throw new Error(`Missing packaged native module path: ${file}`)
  }
  for (const file of required.filter((candidate) => candidate.endsWith('.node'))) {
    const expected = file.includes('arm64') ? 'arm64' : 'x64'
    const found = platform === 'darwin'
      ? architectures(file).map(normalizeArchitecture)
      : [nativeArchitecture(file)]
    if (!found.includes(expected)) throw new Error(`Native module expected ${expected} but found ${found.join(' ') || 'no architectures'}: ${file}`)
  }
  return required
}

async function afterPack(context) {
  const platform = context.electronPlatformName ?? process.platform
  if (platform !== 'darwin' && platform !== 'win32') return
  const appPath = platform === 'darwin'
    ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
    : context.appOutDir
  const arch = ARCH_NAMES[context.arch] ?? (context.appOutDir.includes('mac-universal') ? 'universal' : undefined)
  validatePackagedNativeModules({ appPath, arch, platform })
  console.log(`Validated packaged ${platform} native modules for ${arch}: ${appPath}`)
  if (platform === 'darwin' && process.platform === 'darwin') execFileSync('xattr', ['-cr', appPath], { stdio: 'inherit' })
}

exports.validatePackagedNativeModules = validatePackagedNativeModules
exports.peArchitecture = peArchitecture
exports.default = afterPack
