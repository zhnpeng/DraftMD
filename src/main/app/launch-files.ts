import { isAbsolute, resolve, win32 } from 'node:path'

export function launchFiles(argv: string[], packaged: boolean, cwd: string, platform: NodeJS.Platform = process.platform): string[] {
  const paths = platform === 'win32' ? win32 : { isAbsolute, resolve }
  return argv.slice(packaged ? 1 : 2)
    .filter(arg => !arg.startsWith('-') && /\.(?:md|markdown)$/i.test(arg))
    .map(arg => paths.isAbsolute(arg) ? arg : paths.resolve(cwd, arg))
}
