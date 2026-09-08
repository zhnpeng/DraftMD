const { createHash } = require('node:crypto')
const { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync } = require('node:fs')
const { get } = require('node:https')
const { dirname, join } = require('node:path')
const { execFileSync } = require('node:child_process')
const { builtinModules, createRequire } = require('node:module')
const { readdirSync } = require('node:fs')

const NATIVE_TARGETS = {
  darwin: {
    universal: {
      betterSqlite3: ['darwin-arm64.node', 'darwin-x64.node'],
      keyring: [
        { name: '@napi-rs/keyring-darwin-arm64', binary: 'keyring.darwin-arm64.node' },
        { name: '@napi-rs/keyring-darwin-x64', binary: 'keyring.darwin-x64.node' },
      ],
    },
  },
  win32: {
    x64: {
      betterSqlite3: ['win32-x64.node'],
      keyring: [{ name: '@napi-rs/keyring-win32-x64-msvc', binary: 'keyring.win32-x64-msvc.node' }],
    },
  },
}

const KEYRING_PACKAGES = Object.values(NATIVE_TARGETS).flatMap((platform) => Object.values(platform).flatMap((target) => target.keyring.map(({ name }) => name)))

function nativeTarget(platform = 'darwin', arch = 'universal') {
  const target = NATIVE_TARGETS[platform]?.[arch]
  if (!target) throw new Error(`Unsupported native package target: ${platform} ${arch}`)
  return { platform, arch, ...target }
}

function parseTargetArguments(args) {
  let platform = 'darwin'
  let arch = 'universal'
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--platform') platform = args[++index]
    else if (argument.startsWith('--platform=')) platform = argument.slice('--platform='.length)
    else if (argument === '--arch') arch = args[++index]
    else if (argument.startsWith('--arch=')) arch = argument.slice('--arch='.length)
    else throw new Error(`Unknown native package option: ${argument}`)
  }
  return nativeTarget(platform, arch)
}

function lockedPackage(lock, name) {
  const item = lock?.packages?.[`node_modules/${name}`]
  if (!item?.version || !item?.resolved || !item?.integrity) throw new Error(`Incomplete lockfile entry for ${name}`)
  return item
}

function verifyIntegrity(bytes, integrity) {
  const [algorithm, expected] = integrity.split('-', 2)
  if (algorithm !== 'sha512' || !expected) throw new Error(`Unsupported package integrity: ${integrity}`)
  const actual = createHash(algorithm).update(bytes).digest('base64')
  if (actual !== expected) throw new Error('Native package integrity verification failed')
}

function download(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Too many package redirects'))
    const expected = new URL(url)
    if (expected.protocol !== 'https:') return reject(new Error('Native packages require HTTPS'))
    get(expected, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume()
        const next = new URL(response.headers.location, expected)
        if (next.protocol !== 'https:') return reject(new Error('Native package redirect must use HTTPS'))
        return download(next.href, redirects + 1).then(resolve, reject)
      }
      if (response.statusCode !== 200) {
        response.resume()
        return reject(new Error(`Native package download failed with HTTP ${response.statusCode}`))
      }
      const chunks = []
      response.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      response.on('end', () => resolve(Buffer.concat(chunks)))
      response.on('error', reject)
    }).on('error', reject)
  })
}

const BUILTINS = new Set(builtinModules.flatMap((name) => [name, `node:${name.replace(/^node:/, '')}`]))

function runtimePackageRoots(source) {
  const roots = []
  for (const match of source.matchAll(/require\(["']([^"']+)["']\)/g)) {
    const request = match[1]
    if (request.startsWith('.') || request === 'electron' || BUILTINS.has(request)) continue
    const root = request.startsWith('@') ? request.split('/').slice(0, 2).join('/') : request.split('/')[0]
    if (!roots.includes(root)) roots.push(root)
  }
  return roots.sort()
}

function findPackage(requireFromRoot, name, paths) {
  const entry = requireFromRoot.resolve(name, { paths })
  let directory = dirname(entry)
  while (true) {
    const packageJson = join(directory, 'package.json')
    if (existsSync(packageJson)) {
      const metadata = JSON.parse(readFileSync(packageJson, 'utf8'))
      if (metadata.name === name) return { directory, metadata }
    }
    const parent = dirname(directory)
    if (parent === directory) throw new Error(`Unable to locate package root for ${name}`)
    directory = parent
  }
}

function runtimeClosure(root) {
  const requireFromRoot = createRequire(join(root, 'package.json'))
  const sourceFiles = [join(root, 'dist/main/index.js'), ...readdirSync(join(root, 'dist/main/chunks')).filter((name) => name.endsWith('.js')).map((name) => join(root, 'dist/main/chunks', name))]
  const queue = [...new Set(sourceFiles.flatMap((file) => runtimePackageRoots(readFileSync(file, 'utf8'))))].map((name) => ({ name, paths: [root] }))
  const packages = new Map()
  while (queue.length) {
    const { name, paths } = queue.shift()
    if (packages.has(name)) continue
    const { directory, metadata } = findPackage(requireFromRoot, name, paths)
    packages.set(name, directory)
    for (const dependency of [...Object.keys(metadata.dependencies ?? {}), ...Object.keys(metadata.optionalDependencies ?? {})]) {
      try {
        findPackage(requireFromRoot, dependency, [directory])
        if (!packages.has(dependency)) queue.push({ name: dependency, paths: [directory] })
      } catch { /* Optional dependency is not installed for this platform. */ }
    }
  }
  return packages
}


function findDirectories(root, name) {
  const found = []
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const target = join(directory, entry.name)
      if (!entry.isDirectory()) continue
      if (entry.name === name) found.push(target)
      else visit(target)
    }
  }
  if (existsSync(root)) visit(root)
  return found
}

function findSymlinks(root) {
  const found = []
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const target = join(directory, entry.name)
      if (entry.isSymbolicLink()) found.push(target)
      else if (entry.isDirectory()) visit(target)
    }
  }
  if (existsSync(root)) visit(root)
  return found
}

function stageLegalNotices(root, packageRoot) {
  cpSync(join(root, 'LICENSE'), join(packageRoot, 'LICENSE'))
  cpSync(join(root, 'NOTICE.md'), join(packageRoot, 'NOTICE.md'))
}

async function ensureKeyringPackage(root, lock, keyring) {
  const target = join(root, 'node_modules', ...keyring.name.split('/'))
  const binary = join(target, keyring.binary)
  if (existsSync(binary)) return
  const item = lockedPackage(lock, keyring.name)
  const bytes = await download(item.resolved)
  verifyIntegrity(bytes, item.integrity)
  const staging = `${target}.draftmd-tmp`
  const archive = `${target}.draftmd-tmp.tgz`
  rmSync(staging, { recursive: true, force: true })
  rmSync(archive, { force: true })
  mkdirSync(staging, { recursive: true })
  mkdirSync(dirname(archive), { recursive: true })
  require('node:fs').writeFileSync(archive, bytes, { mode: 0o600 })
  try {
    execFileSync('tar', ['-xzf', archive, '--strip-components=1', '-C', staging])
    if (!existsSync(join(staging, keyring.binary))) {
      throw new Error(`Native package archive missing expected binary: ${keyring.name}`)
    }
    rmSync(target, { recursive: true, force: true })
    renameSync(staging, target)
  } finally {
    rmSync(staging, { recursive: true, force: true })
    rmSync(archive, { force: true })
  }
}

function nativeCopiesForTarget(target) {
  return [
    ['node_modules/better-sqlite3/lib', 'better-sqlite3/lib'],
    ['node_modules/better-sqlite3/package.json', 'better-sqlite3/package.json'],
    ...target.betterSqlite3.map((binary) => [`node_modules/better-sqlite3/prebuilds/${binary}`, `better-sqlite3/prebuilds/${binary}`]),
    ['node_modules/@napi-rs/keyring/index.js', '@napi-rs/keyring/index.js'],
    ['node_modules/@napi-rs/keyring/package.json', '@napi-rs/keyring/package.json'],
    ...target.keyring.map(({ name }) => [`node_modules/${name}`, name]),
  ]
}

function stagedPackageMetadata(project) {
  return {
    name: project.name,
    productName: project.productName,
    version: project.version,
    description: project.description,
    main: project.main,
    license: project.license,
    author: 'DraftMD contributors',
    repository: project.repository,
  }
}

async function prepareNativePackages(root = process.cwd(), target = nativeTarget()) {
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'))
  for (const keyring of target.keyring) await ensureKeyringPackage(root, lock, keyring)
  const packageRoot = join(root, '.build/package')
  const stage = join(packageRoot, 'node_modules')
  rmSync(packageRoot, { recursive: true, force: true })
  const packages = runtimeClosure(root)
  for (const [name, source] of packages) {
    const target = join(stage, ...name.split('/'))
    mkdirSync(dirname(target), { recursive: true })
    cpSync(source, target, { recursive: true })
  }
  for (const name of ['better-sqlite3', '@napi-rs/keyring', ...KEYRING_PACKAGES]) {
    rmSync(join(stage, ...name.split('/')), { recursive: true, force: true })
  }
  for (const [source, destination] of nativeCopiesForTarget(target)) {
    const target = join(stage, destination)
    mkdirSync(dirname(target), { recursive: true })
    cpSync(join(root, source), target, { recursive: true })
  }
  for (const bin of findDirectories(stage, '.bin')) rmSync(bin, { recursive: true, force: true })
  const stagedSymlinks = findSymlinks(stage)
  if (stagedSymlinks.length) throw new Error(`Runtime stage contains symlink: ${stagedSymlinks[0]}`)
  for (const target of ['main', 'preload', 'renderer']) {
    cpSync(join(root, 'dist', target), join(packageRoot, 'dist', target), { recursive: true })
  }
  cpSync(join(root, 'scripts/afterPack.js'), join(packageRoot, 'scripts/afterPack.js'))
  cpSync(join(root, 'resources'), join(packageRoot, 'resources'), { recursive: true })
  cpSync(join(root, 'electron-builder.yml'), join(packageRoot, 'electron-builder.yml'))
  stageLegalNotices(root, packageRoot)
  const project = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const packageMetadata = stagedPackageMetadata(project)
  require('node:fs').writeFileSync(join(packageRoot, 'package.json'), `${JSON.stringify(packageMetadata, null, 2)}\n`)
  require('node:fs').writeFileSync(join(packageRoot, 'package-lock.json'), `${JSON.stringify({
    name: project.name,
    version: project.version,
    lockfileVersion: 3,
    requires: true,
    packages: { '': packageMetadata },
  }, null, 2)}\n`)

}

module.exports = { KEYRING_PACKAGES, nativeTarget, parseTargetArguments, lockedPackage, verifyIntegrity, runtimePackageRoots, runtimeClosure, findSymlinks, stageLegalNotices, nativeCopiesForTarget, stagedPackageMetadata, prepareNativePackages }

if (require.main === module) {
  const target = parseTargetArguments(process.argv.slice(2))
  prepareNativePackages(process.cwd(), target).then(
    () => console.log(`Prepared locked ${target.platform} ${target.arch} native packages.`),
    (error) => { console.error(error.message); process.exitCode = 1 },
  )
}
