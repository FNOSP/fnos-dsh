/**
 * 展示前的授权目录校验与剔除（FNOS-009-10）。
 *
 * 从卡片组件里抽出：这里只依赖 SDK 契约与校验服务，不引入任何 UI 组件，
 * 因此可以在没有 DOM 环境的测试里直接覆盖全部分支（本仓库没有
 * jsdom / happy-dom）。
 */

import type { AuthorizedDirectory } from '../../contracts/authorized-directories-contract.ts'
import { validateAuthorizedDirectories, type AuthorizeCapableSdk } from './authorized-directories-validation.ts'

/**
 * 校验所需的 SDK 形状：既要能 ready()，也要能逐项授权校验。
 *
 * 这里刻意**不**从 `./sdk.ts` 引入 `FnosTrimApp`：那个模块会 import
 * `@trimjs/web-app`，而它在加载时就要求 `window`，于是任何在 Node 环境里
 * 引入本模块的测试都会在 import 阶段炸掉。用结构化类型描述所需能力即可，
 * 真正的 SDK 实例在类型上依然兼容。
 */
export interface EvictionSdk extends AuthorizeCapableSdk {
  ready(): Promise<unknown>
}

/** 默认构造器由调用方注入，避免本模块依赖浏览器全局。 */
export type EvictionSdkFactory = () => EvictionSdk

/** 与卡片一致的日志前缀，抽出来是为了让本模块可独立测试。 */
const LOG_PREFIX = '[dsh-fnos][authorized-directories]'

/**
 * `sdk.ready()` 的超时。
 *
 * fnOS SDK 的桥接初始化最后一步是 Penpal 握手，而**握手本身没有超时**：宿主
 * 不回复 SYN-ACK 时 `ready()` 永不 settle。没有这道兜底，界面会永久停在
 * 「正在加载授权目录」，且不会给出任何提示。
 */
const READY_TIMEOUT_MS = 10_000

/** 在超时后以 `undefined` 结束等待；调用方按「桥接不可用」处理。 */
async function readyWithTimeout(ready: Promise<unknown>, timeoutMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const settled = await Promise.race([
      ready.then(() => true, () => false),
      new Promise<false>(resolve => { timer = setTimeout(resolve, timeoutMs, false) }),
    ])
    if (!settled) throw new Error(`fnOS SDK was not ready within ${timeoutMs}ms`)
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/** 降级提示的文案键；由调用方翻译后展示。 */
export type EvictionNoticeKey = 'validateUnavailable'

export interface EvictionResult {
  /** 剔除后应当展示的列表。 */
  directories: AuthorizedDirectory[]
  /** 是否发生了剔除；为 true 时调用方需要回写持久化。 */
  evicted: boolean
  /** 需要展示给用户的降级提示（桥接不可用时）。 */
  noticeKey?: EvictionNoticeKey
}

/**
 * 校验用户授权目录并剔除失效项。
 *
 * 只对**可移除**（即用户自己添加的）目录做剔除：只读的应用共享路径不属于
 * 用户授权，问了也不该删。桥接整体不可用时直接返回原列表并给出提示，
 * 不剔除也不报错——这是 10-AC-04 要求的降级路径。
 *
 * @param directories - 当前展示列表。
 * @param createSdk - SDK 构造器，可注入以便测试。
 * @param timeouts - 可选的超时覆盖，仅测试需要传；生产使用默认值。
 * @returns 剔除结果与可选的降级提示。
 */
export async function evictInvalidDirectories(
  directories: AuthorizedDirectory[],
  createSdk: EvictionSdkFactory,
  timeouts: { readyMs?: number, authorizeMs?: number } = {},
): Promise<EvictionResult> {
  const candidates = directories.filter(directory => directory.removable).map(directory => directory.path)
  // 没有可校验项时不必构造 SDK：既省一次桥接，也避免纯只读列表被误判为降级。
  if (candidates.length === 0) return { directories, evicted: false }

  let sdk: EvictionSdk
  try {
    sdk = createSdk()
    await readyWithTimeout(sdk.ready(), timeouts.readyMs ?? READY_TIMEOUT_MS)
  } catch (error: unknown) {
    console.warn(LOG_PREFIX, 'validate-sdk-unavailable', {
      message: error instanceof Error ? error.message : undefined,
    })
    return { directories, evicted: false, noticeKey: 'validateUnavailable' }
  }

  const outcome = await validateAuthorizedDirectories(sdk, candidates, timeouts.authorizeMs)
  if (!outcome.available) {
    console.info(LOG_PREFIX, 'validate-skipped', { reason: 'sdk-unavailable' })
    return { directories, evicted: false, noticeKey: 'validateUnavailable' }
  }
  if (outcome.invalid.length === 0) return { directories, evicted: false }

  const invalidPaths = new Set(outcome.invalid)
  console.info(LOG_PREFIX, 'validate-evicted', { count: invalidPaths.size })
  return {
    directories: directories.filter(directory => !invalidPaths.has(directory.path)),
    evicted: true,
  }
}
