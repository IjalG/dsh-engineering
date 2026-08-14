/**
 * Standalone build config for the dsh-nas system package.
 *
 * Uses the repo's shared client-bundle preset (shared/tsdown.client.ts):
 * node-half lib/ (host desktop services + /api/nas routes) plus the browser
 * bundle lib/client.js (closure-factory artifact, CSS Modules inlined).
 */
import { clientBundle } from '../../../dsh-web-ui/shared/tsdown.client.ts'

export default clientBundle('@linxin666/dsh-nas', ['src/index.ts'], {
  libExternal: [
    '@deepseek-ai/dsh-host-webserver',
    '@deepseek-ai/dsh-session',
    '@deepseek-ai/dsh-settings',
  ],
})
