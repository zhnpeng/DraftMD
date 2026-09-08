const { buildForTests } = require('../../scripts/build-for-tests.js')

export default function globalSetup(): void {
  buildForTests(process.cwd(), 'inherit')
}
