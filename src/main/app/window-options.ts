import type { BrowserWindowConstructorOptions } from 'electron'

export function windowChrome(platform: NodeJS.Platform): BrowserWindowConstructorOptions {
  return platform === 'darwin'
    ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 14 } }
    : { titleBarStyle: 'default', autoHideMenuBar: false }
}
