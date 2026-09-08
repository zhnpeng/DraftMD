const { execFileSync } = require('node:child_process')
const { join } = require('node:path')
const { buildForTests } = require('./build-for-tests')
const { prepareNativePackages, nativeTarget } = require('./prepare-native-packages')

async function main() {
  const root = process.cwd()
  buildForTests(root, 'inherit')
  await prepareNativePackages(root, nativeTarget('win32', 'x64'))
  execFileSync(process.execPath, [
    require.resolve('electron-builder/cli.js'), '--config', 'electron-builder.yml',
    '--win', '--x64', '--publish', 'never', ...process.argv.slice(2),
  ], { cwd: join(root, '.build/package'), stdio: 'inherit' })
}

main().catch(error => { console.error(error.message); process.exitCode = 1 })
