import { config } from 'zod'

// Preload executes under the renderer CSP. Disable Zod's optional JIT before
// contract schemas initialize so strict script-src never encounters eval.
config({ jitless: true })
