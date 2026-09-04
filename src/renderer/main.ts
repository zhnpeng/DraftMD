import './themes/base.css'
import './themes/premium.css'
import './settings/provider-settings.css'
import './agent/agent-dock.css'
import { bootstrapRenderer } from './app/bootstrap'

function start(): void {
  void bootstrapRenderer().catch((error) => console.error('DraftMD init failed:', error))
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true })
else start()
