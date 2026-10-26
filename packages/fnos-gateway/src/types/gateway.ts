import type { Server } from 'node:http'
import type { PathAllowlistStore } from '../server/path-allowlist.js'
import type { WebProcessController } from '../server/web-process.js'

export interface GatewayOptions {
  socketPath: string
  gatewayPrefix: string
  upstreamHost: string
  upstreamPort: number
  sseKeepaliveInterval?: number
  pathAllowlist?: PathAllowlistStore
  webProcess?: WebProcessController
}

export interface GatewayServer {
  server: Server
  close: () => Promise<void>
  /** 预热网关持有的 DSH 会话；DSH Web 启动后调用。 */
  warmSession: () => Promise<void>
}
