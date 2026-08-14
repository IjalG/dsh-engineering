/**
 * Build config for the dsh-mail software package.
 */
import { clientBundle } from '../../../dsh-web-ui/shared/tsdown.client.ts'

export default clientBundle('@linxin666/dsh-mail', ['src/index.ts'], {
  libExternal: ['@deepseek-ai/dsh-host-webserver', '@deepseek-ai/dsh-session'],
})
