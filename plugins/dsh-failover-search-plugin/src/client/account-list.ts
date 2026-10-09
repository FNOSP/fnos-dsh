/**
 * 账号列表的配置写入模型。
 *
 * 官方配置表单的写入语义是**路径操作**（`{ op, path, value }`），一次 `mutate` 携带
 * 一组 op 并共享同一个修订号栅栏。账号列表的增删改因此被表达成下标级操作：
 *
 * - 追加：对 `index === length` 做 `set`（宿主允许，等于尾部插入）；
 * - 删除：对该下标做 `unset`（宿主用 `splice` 移除元素，其余元素左移）；
 * - 修改：对 `字段` 做 `set`，只写要改的那个字段。
 *
 * 为什么把下标映射单独抽出来：`unset` 一个数组下标会移除元素而不是留空位，若在下标
 * 失效（并发删除、快照过期）时照常提交，改的就是「另一个账号」。这一层把下标语义
 * 集中表达，供上层在提交前做一致性检查。
 */
import type { AccountConfig } from '../contracts/config.ts'

/**
 * 官方配置表单一次写入使用的路径操作。
 *
 * 形状必须与宿主的 `SettingsPathOpView` 一致：`path` 是**可变** `string[]`（readonly
 * 数组会在跨线写入时被判为类型不匹配），`value` 是 JSON 可序列化取值。
 */
export type SettingsFormPathOp =
  | { op: 'set', path: string[], value: string | boolean | { key: string, label?: string } }
  | { op: 'unset', path: string[] }

/** 两个平台的账号列表字段名。 */
export type AccountField = 'tinyfishAccounts' | 'tavilyAccounts'

/**
 * 追加一个账号。
 *
 * @param field - 账号列表字段名。
 * @param currentLength - 当前列表长度；追加写在该下标上。
 * @param account - 新账号（key 与可选备注名）。
 * @returns 一次 `set` 路径操作。
 */
export function appendAccountOp(field: AccountField, currentLength: number, account: AccountConfig): SettingsFormPathOp {
  // 只带用户填写的字段：省略备注名时不要写一个 `label: undefined`，
  // 避免把「字段缺席」变成「字段被覆盖成空」。
  const value: AccountConfig = account.label === undefined || account.label.length === 0
    ? { key: account.key }
    : { key: account.key, label: account.label }
  return { op: 'set', path: [field, String(currentLength)], value }
}

/**
 * 删除一个账号。
 *
 * @param field - 账号列表字段名。
 * @param index - 要删除的下标。
 * @returns 一次 `unset` 路径操作（宿主按 `splice` 语义移除该元素）。
 */
export function removeAccountOp(field: AccountField, index: number): SettingsFormPathOp {
  return { op: 'unset', path: [field, String(index)] }
}

/**
 * 修改一个账号的字段。
 *
 * 只写传进来的字段：`key` 与 `label` 各自独立成 op，未传的字段保持原值——避免用
 * 「整条替换」把用户没碰过的备注名或（更严重的）已存储的 key 覆盖掉。
 *
 * @param field - 账号列表字段名。
 * @param index - 账号下标。
 * @param patch - 要写入的字段（`key` 与/或 `label`）。
 * @returns 该账号的路径操作列表，`key` 在前、`label` 在后。
 */
export function updateAccountOp(field: AccountField, index: number, patch: { key?: string, label?: string }): SettingsFormPathOp {
  // **逐字段**写入：整条替换会把用户没碰过的字段一起写进去，而 key 是 secret 角色、
  // 读取面永远拿不到明文——整条替换等于把已存储的 key 抹掉。
  if (patch.key !== undefined) return { op: 'set', path: [field, String(index), 'key'], value: patch.key }
  return { op: 'set', path: [field, String(index), 'label'], value: patch.label ?? '' }
}

/**
 * 判断一组 op 是否仍与读取时的列表一致。
 *
 * 提交前用当前快照的下标与长度复核：列表被并发改动（删除/新增）后，闭包里记下的
 * 下标可能指向另一个账号，此时应放弃这次写入而不是改动别人的条目。
 *
 * @param field - 账号列表字段名。
 * @param op - 待提交的路径操作。
 * @param current - 提交时的列表快照。
 * @returns 该 op 的下标在当前列表中是否仍指向同一元素（追加操作按下标合法性判断）。
 */
export function opStillValid(op: SettingsFormPathOp, current: readonly AccountConfig[]): boolean {
  const index = Number(op.path[1])
  if (!Number.isInteger(index) || index < 0) return false
  // 追加允许 index === length；删除/修改要求下标已存在。
  return op.op === 'set' && op.path.length === 2 ? index <= current.length : index < current.length
}

/** host 侧送来的账号展示信息（与 `contracts/usage-rpc.ts` 的 `AccountSummary` 同形）。 */
export interface AccountSummaryView {
  /** 平台 id。 */
  readonly platform: string
  /** 账号代号。 */
  readonly label: string
  /** key 的不可还原掩码。 */
  readonly maskedKey: string
}

/** 配置读取面给出的账号（key 恒缺席：secret 角色不跨线）。 */
export interface ConfiguredAccountView {
  /** 备注名；未配置时为 undefined。 */
  readonly label?: string | undefined
}

/** 一行账号的展示模型。 */
export interface AccountRow {
  /** 账号代号；未配备注名时为 undefined（由列表按下标生成）。 */
  readonly label?: string | undefined
  /** key 掩码；host 尚未返回或配对失败时为 undefined。 */
  readonly maskedKey?: string | undefined
}

/**
 * 把配置里的账号与 host 的 key 掩码按**平台 + 代号**配对。
 *
 * 为什么需要配对：明文 key 是 secret 角色，配置读取面会把它整体移除，客户端拿不到
 * 任何 key 片段；掩码由 host 单独经 RPC 送过来。两份数据来源不同，必须按身份对齐，
 * 否则同平台多账号会把掩码串到别的行上。
 *
 * 代号是配对键：host 与客户端都按「备注名或 `平台-序号`」生成（见 `buildPool`），
 * 因此未配备注名的账号也能对齐。配不上的行保持 `maskedKey: undefined`，由界面回落到
 * 「已保存」状态，而不是显示空或猜一个值。
 *
 * @param accounts - 配置读取面给出的账号列表（顺序即配置顺序）。
 * @param summaries - host 送来的账号展示信息。
 * @param platform - 本列表所属平台；省略时不做平台过滤（调用方已保证同平台）。
 * @returns 与 `accounts` 等长、顺序一致的行列表。
 */
export function mergeAccountRows(
  accounts: readonly ConfiguredAccountView[],
  summaries: readonly AccountSummaryView[],
  platform?: string,
): readonly AccountRow[] {
  const byLabel = new Map<string, string>()
  for (const summary of summaries) {
    if (platform !== undefined && summary.platform !== platform) continue
    byLabel.set(summary.label, summary.maskedKey)
  }

  return accounts.map((account, index) => {
    // 未配备注名时按下标推导代号，与 host 的 `buildPool` 规则一致。
    const label = account.label === undefined || account.label.length === 0
      ? platform === undefined ? undefined : `${platform}-${index + 1}`
      : account.label
    const maskedKey = label === undefined ? undefined : byLabel.get(label)
    return {
      ...(account.label === undefined ? {} : { label: account.label }),
      ...(maskedKey === undefined ? {} : { maskedKey }),
    }
  })
}
