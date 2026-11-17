/**
 * 「依赖修复」的契约：路由路径、诊断结果与修复结果。
 *
 * 这个功能解决的是**应用内装不上插件**：profile 的 `minimumReleaseAgeExclude`
 * 里残留着锚在旧版本上的豁免条目时，pnpm 按 First-Match-Wins 短路，新版本反而
 * 拿不到豁免，被发布冷静期拦下（`ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`）。
 *
 * 契约放在这里而不是各自一侧，是因为宿主与浏览器必须对「什么算失效」「修复
 * 做了哪几步」用同一套说法——两边各写一份判定，界面上说的和实际做的就会漂移。
 *
 * @module dsh-fnos/dependency-repair-contract
 */

/** 诊断（只读）。 */
export const FNOS_DEPENDENCY_REPAIR_DIAGNOSE_ROUTE = '/plugins/dsh-fnos/dependency-repair/diagnose'

/** 修复（写）。 */
export const FNOS_DEPENDENCY_REPAIR_RUN_ROUTE = '/plugins/dsh-fnos/dependency-repair/run'

/** 一条豁免条目的失效原因。 */
export type DependencyRepairReason =
  /** 条目锚定的版本已不是当前安装目标，pnpm 不会再放行任何东西。 */
  | 'stale-version'
  /** 历史上用 `||` 合并多版本的写法，会让后续 pnpm add 解析异常。 */
  | 'pipe-union'

/** 一条失效的豁免条目。 */
export interface DependencyRepairEntry {
  /** 包名。 */
  readonly name: string
  /** 原始范围文本（`6.0.0` 或 `1.0.0 || 2.0.0`）。 */
  readonly range: string
  readonly reason: DependencyRepairReason
  /** 当前安装目标版本；未知时不出现。 */
  readonly targetVersion?: string
}

/** 诊断结果。 */
export interface DependencyRepairDiagnosis {
  /** 是否可用（拿不到应用环境的宿主里为 false，界面上给可读原因）。 */
  readonly available: boolean
  /** 不可用或不执行修复的原因代码。 */
  readonly reason?: 'fnos-host-unavailable' | 'profile-missing'
  /** 失效条目；空数组表示依赖状态正常。 */
  readonly entries: readonly DependencyRepairEntry[]
  /** 本次诊断读到的 profile 目录（便于用户核对，不含敏感信息）。 */
  readonly profileDirectory?: string
}

/** 修复步骤的状态。 */
export interface DependencyRepairStep {
  readonly id: 'clear-exclusions' | 'rebuild' | 'reinstall'
  readonly status: 'ok' | 'skipped' | 'failed'
  /** 失败原因或跳过说明（可读）。 */
  readonly detail?: string
  /**
   * 修复前的配置备份完整路径（仅 `clear-exclusions` 步骤可能携带）。
   *
   * 只在**点击**时用：界面显示的是 `backupDisplayPath` 这个语义化相对路径，
   * 点一下把它复制到剪贴板才需要完整路径。
   */
  readonly backupPath?: string
  /** 备份文件的语义化路径，相对应用共享目录（如 `备份/pnpm-workspace-….yaml`）。 */
  readonly backupDisplayPath?: string
}

/** 修复结果。 */
export interface DependencyRepairResult {
  readonly ok: boolean
  readonly steps: readonly DependencyRepairStep[]
  /** 被清掉的豁免条目。 */
  readonly removed: readonly DependencyRepairEntry[]
  /** 本次修复的耗时（毫秒）。 */
  readonly durationMs: number
  /**
   * 本次实际**做了什么**。
   *
   * `steps` 是「执行了哪几步」，但「什么都没执行」也是一种结论，而它无法用空
   * 数组与「请求没到」区分开。此前界面按 `steps.length > 0` 决定要不要展示结果，
   * 健康的 profile 走「无失效条目，跳过重建」分支返回 `steps: []`，于是用户点完
   * 修复只看到进度行闪一下就没了——既不知道修没修，也不知道结论是什么。
   *
   * 因此把结论显式化：
   * - `repaired`：真的重建过依赖并成功。
   * - `healthy`：诊断过，依赖状态正常，未做任何改动。
   * - `unavailable`：当前环境不具备修复条件（未读到 fnOS 应用目录）。
   * - `failed`：走了重建流程但中途失败，原因在 `message` 与各步骤的 `detail`。
   */
  readonly outcome: 'repaired' | 'healthy' | 'unavailable' | 'failed'
  /** 失败时给用户看的说明。 */
  readonly message?: string
}
