const { execFileSync } = require('node:child_process')
const { dirname, join } = require('node:path')

function buildForTests(root = process.cwd(), stdio = 'pipe') {
  const cli = join(dirname(require.resolve('electron-vite/package.json')), 'bin/electron-vite.js')
  execFileSync(process.execPath, [cli, 'build'], { cwd: root, stdio })
}

module.exports = { buildForTests }
