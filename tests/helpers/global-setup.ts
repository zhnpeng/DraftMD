import { execFileSync } from 'node:child_process'

export default function globalSetup(): void {
  execFileSync('npm', ['run', 'build'], { cwd: process.cwd(), stdio: 'inherit' })
}
