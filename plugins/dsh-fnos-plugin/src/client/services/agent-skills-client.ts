/**
 * agent skill 的检测与清理（客户端）。
 *
 * @module dsh-fnos/client/services/agent-skills-client
 */

import {
  FNOS_AGENT_SKILLS_CLEANUP_ROUTE,
  FNOS_AGENT_SKILLS_ROUTE,
} from '../../contracts/gateway-proxy-contract.ts'

/** 清理状态。 */
export interface AgentSkillsStatus {
  /** skills 根目录；宿主无法解析时为 undefined。 */
  readonly root?: string
  /** 当前存在、可被清理的目录名。 */
  readonly present: readonly string[]
  /** 每个目录的绝对路径与语义化展示形式，用于确认框告知「删哪个位置」。 */
  readonly entries?: readonly { name: string, path: string, displayPath: string }[]
}

/** 清理结果。 */
export interface AgentSkillsCleanupResult {
  readonly removed: readonly string[]
  readonly failed: readonly { name: string, message: string }[]
  readonly status: AgentSkillsStatus
}

/**
 * 读清理状态。
 * @returns 根目录与存在的目录名。
 */
export async function fetchAgentSkillsStatus(): Promise<AgentSkillsStatus> {
  const response = await fetch(FNOS_AGENT_SKILLS_ROUTE, {
    headers: { accept: 'application/json' },
    credentials: 'same-origin',
    cache: 'no-store',
  })
  if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
  return await response.json() as AgentSkillsStatus
}

/**
 * 执行清理。
 * @returns 成功与失败的清单、以及清理后的状态。
 */
export async function cleanupAgentSkillsRemote(): Promise<AgentSkillsCleanupResult> {
  const response = await fetch(FNOS_AGENT_SKILLS_CLEANUP_ROUTE, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: '{}',
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => undefined) as { message?: unknown } | undefined
    throw new Error(typeof payload?.message === 'string' ? payload.message : `HTTP ${String(response.status)}`)
  }
  return await response.json() as AgentSkillsCleanupResult
}
