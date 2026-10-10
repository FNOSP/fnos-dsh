/**
 * 插件详情页的配置区（官方配置表单承载）。
 *
 * 承载策略（插件 UI 规范「配置项 UI 选择顺序」）：能由官方 `Config` schema 表达的
 * 字段**必须**留在官方表单里——超时、刷新间隔由官方 `SettingsValueField` 渲染，保存走
 * 官方 `mutate`（带修订号栅栏），而不是自己写一套表单与存储。
 *
 * 两处官方字段原语表达不了、因此按规范自绘的部分：
 *
 * 1. **布尔开关**：官方 `@deepseek-ai/dsh-client-ui-primitives` 只导出文本、数字与
 *    密钥三类字段原语，没有布尔控件；用文本字段表达开关会让用户手打 `true`/`false`。
 * 2. **账号列表**：官方字段原语没有对象列表的可增行控件，无法表达「按行增删 key 与
 *    备注名」这一流程。
 *
 * 两者都只负责**交互**：写入仍通过同一个官方 `mutate` 落到同一份配置文档。
 *
 * 表单状态经 `SettingsFormModel.bind()` 的订阅式 store 读取并 `useSyncExternalStore`
 * 订阅：只读一次 `model.field()` 拿到的是快照，用户输入不会回流到界面（表现为输入框
 * 打不进字）。
 */
import type { ReactNode } from 'react'
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { DshButton, DshInput, DshSwitch, DshTag, DshTypography } from '@tnnevol/dsh-semi-ui'
import { SettingsForm, SettingsValueField } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SettingsFormModel } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import { OFFICIAL_SOURCE_ID, TAVILY_PLATFORM_ID, TINYFISH_PLATFORM_ID } from '../contracts/constants.ts'
import { appendAccountOp, editAccountPatch, mergeAccountRows, removeAccountOp, updateAccountOp } from './account-list.ts'
import { labelPlaceholderKey } from './locales.ts'
import type { AccountSummaryView, SettingsFormPathOp } from './account-list.ts'
import type { UsageLocaleKey } from './locales.ts'

/** 账号配置项。 */
export interface AccountConfig {
  /** 平台 API key。 */
  readonly key: string
  /** 备注名。 */
  readonly label?: string
}

/** 本插件的配置取值形状。 */
export interface PluginSettings {
  /** TinyFish 账号列表。 */
  readonly tinyfishAccounts: readonly AccountConfig[]
  /** Tavily 账号列表。 */
  readonly tavilyAccounts: readonly AccountConfig[]
  /** 来源顺序。 */
  readonly sourceOrder: readonly string[]
  /** 每来源超时（毫秒）。 */
  readonly timeoutMs: number
  /** 同平台重试开关。 */
  readonly samePlatformRetry: boolean
  /** 用量刷新间隔（分钟）。 */
  readonly usageRefreshMinutes: number
  /** 请求前探测开关。 */
  readonly requestProbe: boolean
}

/** 共享配置表单的读取与写入面（`ConfigForm` 的对应子集）。 */
export type ConfigFormScope = Pick<ConfigForm<PluginSettings>, 'getSnapshot' | 'mutate'>

/** 配置区参数。 */
export interface ConfigSectionProps {
  /** 本地化函数。 */
  readonly t: (key: UsageLocaleKey) => string
  /** 共享配置表单（官方按插件入口 id 取到的那一份）。 */
  readonly form: ConfigFormScope
  /** 官方暂存模型：标量字段的草稿与保存。 */
  readonly model: SettingsFormModel<PluginSettings>
  /**
   * 读取账号 key 掩码。
   *
   * key 是 secret 角色、明文不跨线，界面只能靠 host 送回的不可还原掩码让用户辨认
   * 「这一行是哪个 key」。取不到时返回空数组，界面回落到「已保存」状态。
   */
  readonly loadSummaries: () => Promise<readonly AccountSummaryView[]>
  /**
   * 复制某个账号的 key 到剪贴板。
   *
   * 明文只在这一步由 host 按「平台 + 代号」取回一次，取到即写剪贴板，不进入任何状态。
   */
  readonly copyKey: (platform: string, label: string) => Promise<boolean>
}

/** 三个来源的展示顺序（与默认转移顺序一致）。 */
const SOURCE_ORDER = [TINYFISH_PLATFORM_ID, TAVILY_PLATFORM_ID, OFFICIAL_SOURCE_ID] as const

/** 配置的兜底默认值（命名空间尚未就绪时用，与 schema 默认值一致）。 */
const DEFAULTS: PluginSettings = {
  tinyfishAccounts: [],
  tavilyAccounts: [],
  sourceOrder: [...SOURCE_ORDER],
  timeoutMs: 15000,
  samePlatformRetry: true,
  usageRefreshMinutes: 5,
  requestProbe: true,
}

/** 配置区渲染所需的完整状态。 */
interface ConfigRenderState {
  /** 表单框架状态。 */
  readonly shell: ReturnType<SettingsFormModel<PluginSettings>['shell']>
  /** 配置取值（宿主快照）。 */
  readonly values: PluginSettings
  /** 两个数值字段的草稿状态。 */
  readonly fields: Record<string, { text: string, overridden: boolean, invalid: boolean }>
}

/**
 * 渲染配置区。
 *
 * @param props - 配置区参数。
 * @param props.t - 本地化函数。
 * @param props.form - 共享配置表单（读取与写入）。
 * @param props.model - 官方草稿模型：标量字段的暂存与保存。
 * @param props.loadSummaries - 读取账号 key 掩码（供列表展示）。
 * @param props.copyKey - 复制指定账号的 key 到剪贴板。
 * @returns 配置区元素。
 */
export function FailoverConfigSection({ t, form, model, loadSummaries, copyKey }: ConfigSectionProps): ReactNode {
  // 掩码在挂载时取一次，并在配置快照变化（新增/删除账号）后重取。
  const [summaries, setSummaries] = useState<readonly AccountSummaryView[]>([])
  const hostRevision = form.getSnapshot().revision
  useEffect(() => {
    let live = true
    void loadSummaries().then(next => {
      if (live) setSummaries(next)
    })
    return () => { live = false }
  }, [loadSummaries, hostRevision])

  // 订阅式读取：草稿变化（用户输入）与宿主快照变化（保存回读）都要重渲染。
  const [store] = useState(() => model.bind<ConfigRenderState>(() => ({
    shell: model.shell(),
    values: form.getSnapshot().value ?? DEFAULTS,
    fields: {
      timeoutMs: model.field('timeoutMs'),
      usageRefreshMinutes: model.field('usageRefreshMinutes'),
    },
  })))
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const { shell, values } = state

  /** 一个数值字段：官方字段原语承载。 */
  const valueField = (name: 'timeoutMs' | 'usageRefreshMinutes', labelKey: UsageLocaleKey, hintKey: UsageLocaleKey): ReactNode => {
    const field = state.fields[name] ?? { text: '', overridden: false, invalid: false }
    return (
      <SettingsValueField
        key={name}
        id={`dsh-failover-search-${name}`}
        label={t(labelKey)}
        hint={t(hintKey)}
        overriddenLabel={t('formOverridden')}
        resetLabel={t('formReset')}
        invalidLabel={t('formInvalidNumber')}
        numeric
        disabled={!shell.writable}
        text={field.text}
        overridden={field.overridden}
        invalid={field.invalid}
        onEdit={text => { model.actions().edit(name, text) }}
        onReset={() => { model.actions().resetField(name) }}
      />
    )
  }

  /** 一个布尔开关：官方字段原语没有布尔控件，按规范自绘（见文件头注释）。 */
  const booleanField = (name: 'samePlatformRetry' | 'requestProbe', labelKey: UsageLocaleKey, hintKey: UsageLocaleKey): ReactNode => (
    <div className="dsh-failover-config__switch" key={name}>
      <div className="dsh-failover-config__switchMain">
        <span className="dsh-failover-config__switchLabel">{t(labelKey)}</span>
        <span className="dsh-failover-config__switchHint">{t(hintKey)}</span>
      </div>
      <DshSwitch
        checked={values[name]}
        disabled={!shell.writable}
        aria-label={t(labelKey)}
        onChange={next => { writeOps(form, [{ op: 'set', path: [name], value: next }]) }}
      />
    </div>
  )

  /** 账号列表的增删：官方字段原语没有可增行控件，按规范自绘。 */
  const changeAccounts = useCallback((field: 'tinyfishAccounts' | 'tavilyAccounts', op: SettingsFormPathOp) => {
    writeOps(form, [op])
  }, [form])

  return (
    <SettingsForm
      labels={{
        unavailable: t('formUnavailable'),
        readOnly: t('formReadOnly'),
        saveFailed: t('formSaveFailed'),
        save: t('formSave'),
        saving: t('formSaving'),
      }}
      state={shell}
      onSave={() => { void model.save() }}
      onDiscard={() => { model.actions().discard() }}
    >
      <div className="dsh-failover-config">
        <section className="dsh-failover-config__group">
          <DshTypography.Title heading={6} className="dsh-failover-config__groupTitle">{t('accountsTitle')}</DshTypography.Title>
          <p className="dsh-failover-config__hint">{t('accountsHint')}</p>
          <AccountList
            platform={TINYFISH_PLATFORM_ID}
            title={t('tinyfishTitle')}
            accounts={values.tinyfishAccounts}
            summaries={summaries}
            t={t}
            disabled={!shell.writable}
            onAdd={account => { changeAccounts('tinyfishAccounts', appendAccountOp('tinyfishAccounts', values.tinyfishAccounts.length, account)) }}
            onRemove={index => { changeAccounts('tinyfishAccounts', removeAccountOp('tinyfishAccounts', index)) }}
            onEdit={(index, patch) => { changeAccounts('tinyfishAccounts', updateAccountOp('tinyfishAccounts', index, patch)) }}
            onCopy={copyKey}
          />
          <AccountList
            platform={TAVILY_PLATFORM_ID}
            title={t('tavilyTitle')}
            accounts={values.tavilyAccounts}
            summaries={summaries}
            t={t}
            disabled={!shell.writable}
            onAdd={account => { changeAccounts('tavilyAccounts', appendAccountOp('tavilyAccounts', values.tavilyAccounts.length, account)) }}
            onRemove={index => { changeAccounts('tavilyAccounts', removeAccountOp('tavilyAccounts', index)) }}
            onEdit={(index, patch) => { changeAccounts('tavilyAccounts', updateAccountOp('tavilyAccounts', index, patch)) }}
            onCopy={copyKey}
          />
        </section>

        <section className="dsh-failover-config__group">
          <DshTypography.Title heading={6} className="dsh-failover-config__groupTitle">{t('orderTitle')}</DshTypography.Title>
          <p className="dsh-failover-config__hint">{t('sourceOrderHint')}</p>
          <div className="dsh-failover-config__order">
            <span className="dsh-failover-config__orderLabel">{t('sourceOrder')}</span>
            <span className="dsh-failover-config__orderValue">{sourceOrderText(values.sourceOrder, t)}</span>
          </div>
          <div className="dsh-failover-config__fields">
            {valueField('timeoutMs', 'timeoutMs', 'timeoutMsHint')}
            {booleanField('samePlatformRetry', 'samePlatformRetry', 'samePlatformRetryHint')}
          </div>
        </section>

        <section className="dsh-failover-config__group">
          <DshTypography.Title heading={6} className="dsh-failover-config__groupTitle">{t('usageTitle')}</DshTypography.Title>
          <div className="dsh-failover-config__fields">
            {valueField('usageRefreshMinutes', 'usageRefreshMinutes', 'usageRefreshMinutesHint')}
            {booleanField('requestProbe', 'requestProbe', 'requestProbeHint')}
          </div>
        </section>
      </div>
    </SettingsForm>
  )
}

/** 提交一组路径操作，用当前修订号做栅栏。 */
function writeOps(form: ConfigFormScope, ops: readonly SettingsFormPathOp[]): void {
  void form.mutate(ops, form.getSnapshot().revision)
}

/** 来源顺序的展示文本。 */
function sourceOrderText(order: readonly string[], t: (key: UsageLocaleKey) => string): string {
  const labels: Record<string, string> = {
    [TINYFISH_PLATFORM_ID]: t('tinyfishTitle'),
    [TAVILY_PLATFORM_ID]: t('tavilyTitle'),
    [OFFICIAL_SOURCE_ID]: t('sourceOrderOfficial'),
  }
  const entries = order.length === 0 ? [...SOURCE_ORDER] : order
  return entries.map(entry => labels[entry] ?? entry).join(' → ')
}

/** 账号列表参数。 */
interface AccountListProps {
  /** 所属平台 id（用于与 host 的掩码配对）。 */
  readonly platform: string
  /** 平台标题。 */
  readonly title: string
  /** 当前账号列表。 */
  readonly accounts: readonly AccountConfig[]
  /** host 送来的 key 掩码（按平台 + 代号配对）。 */
  readonly summaries: readonly AccountSummaryView[]
  /** 本地化函数。 */
  readonly t: (key: UsageLocaleKey) => string
  /** 是否只读。 */
  readonly disabled: boolean
  /** 新增一个账号。 */
  readonly onAdd: (account: AccountConfig) => void
  /** 删除指定下标的账号。 */
  readonly onRemove: (index: number) => void
  /** 编辑指定下标的账号（只提交真正改动的字段）。 */
  readonly onEdit: (index: number, patch: { key?: string, label?: string }) => void
  /** 复制本平台某个账号的 key 到剪贴板；返回是否成功。 */
  readonly onCopy: (platform: string, label: string) => Promise<boolean>
}

/** 账号列表：官方配置里承载、Semi UI 自绘交互。 */
function AccountList({ platform, title, accounts, summaries, t, disabled, onAdd, onRemove, onEdit, onCopy }: AccountListProps): ReactNode {
  const [draftKey, setDraftKey] = useState('')
  const [draftLabel, setDraftLabel] = useState('')
  const [editing, setEditing] = useState<number | undefined>(undefined)
  const [editKey, setEditKey] = useState('')
  const [editLabel, setEditLabel] = useState('')
  const [copied, setCopied] = useState<number | undefined>(undefined)
  const canAdd = draftKey.trim().length > 0 && !disabled
  const rows = mergeAccountRows(accounts, summaries, platform)

  const startEdit = (index: number, label: string): void => {
    setEditing(index)
    // key 明文永远拿不到（secret 角色），编辑框一律从空开始：
    // 留空即「不改 key」，这由 editAccountPatch 收敛。
    setEditKey('')
    setEditLabel(label)
  }

  const commitEdit = (index: number): void => {
    onEdit(index, editAccountPatch(accounts[index] ?? {}, { key: editKey, label: editLabel }))
    setEditing(undefined)
    setEditKey('')
    setEditLabel('')
  }

  const copy = (index: number, label: string): void => {
    void onCopy(platform, label).then(ok => {
      if (!ok) return
      setCopied(index)
      // 复制反馈是瞬时的：2 秒后回到常态按钮。
      setTimeout(() => { setCopied(current => (current === index ? undefined : current)) }, 2000)
    })
  }

  const add = () => {
    const key = draftKey.trim()
    if (key.length === 0) return
    const label = draftLabel.trim()
    onAdd(label.length === 0 ? { key } : { key, label })
    setDraftKey('')
    setDraftLabel('')
  }

  return (
    <div className="dsh-failover-accounts">
      <div className="dsh-failover-accounts__head">
        <span className="dsh-failover-accounts__title">{title}</span>
        <DshTag size="small">{String(accounts.length)}</DshTag>
      </div>
      {accounts.length === 0
        ? <p className="dsh-failover-accounts__empty">{t('accountEmpty')}</p>
        : (
            <ul className="dsh-failover-accounts__list">
              {accounts.map((account, index) => (
                // 下标参与 key 是有意的：宿主对账号列表的写入本身就是**下标寻址**
                // （`unset` 按 splice 移除），列表顺序即配置顺序。若用 key 之外的
                // 身份做 key，重命名或换 key 会让 React 复用错行的输入态，而这里
                // 每行只有只读文本与一个删除按钮，下标稳定性正好与配置语义一致。
                <li className="dsh-failover-accounts__item" key={`${account.label ?? ''}-${index}`}>
                  {editing === index
                    ? (
                        // 编辑态：key 输入框从空开始（明文拿不到），留空即不修改；
                        // 备注名带出当前值，清空即删除备注。
                        <div className="dsh-failover-accounts__editor">
                          <div className="dsh-failover-accounts__editrow">
                            <DshInput
                              mode="password"
                              value={editKey}
                              disabled={disabled}
                              placeholder={t('accountEditKeyPlaceholder')}
                              aria-label={t('accountKey')}
                              onChange={value => { setEditKey(value) }}
                            />
                            <DshInput
                              value={editLabel}
                              disabled={disabled}
                              placeholder={t(labelPlaceholderKey(platform))}
                              aria-label={t('accountLabel')}
                              onChange={value => { setEditLabel(value) }}
                            />
                          </div>
                          <div className="dsh-failover-accounts__editactions">
                            <span className="dsh-failover-accounts__edithint">{t('accountEditHint')}</span>
                            <DshButton theme="borderless" size="small" onClick={() => { setEditing(undefined) }}>
                              {t('accountCancel')}
                            </DshButton>
                            <DshButton
                              theme="solid"
                              type="primary"
                              size="small"
                              disabled={disabled}
                              onClick={() => { commitEdit(index) }}
                            >
                              {t('accountSave')}
                            </DshButton>
                          </div>
                        </div>
                      )
                    : (
                        <>
                          <span className="dsh-failover-accounts__index">{`${t('accountIndex')} ${index + 1}`}</span>
                          <span className="dsh-failover-accounts__label">{account.label ?? '—'}</span>
                          {/* key 的明文不跨线：这里展示 host 送来的不可还原掩码，让用户能
                              辨认这一行配的是哪个 key（同平台多账号时尤其必要）。掩码尚未
                              取到时回落到「已保存」状态。 */}
                          <span className="dsh-failover-accounts__key" title={t('accountKeySet')}>
                            {rows[index]?.maskedKey ?? t('accountKeySet')}
                          </span>
                          <DshButton
                            theme="borderless"
                            size="small"
                            disabled={disabled}
                            aria-label={`${t('accountEdit')} ${account.label ?? String(index + 1)}`}
                            onClick={() => { startEdit(index, account.label ?? '') }}
                          >
                            {t('accountEdit')}
                          </DshButton>
                          {/* 复制按「那一行」取明文：host 侧按平台 + 代号定位，成功即写剪贴板。 */}
                          <DshButton
                            theme="borderless"
                            size="small"
                            disabled={disabled}
                            aria-label={`${t('accountCopy')} ${account.label ?? String(index + 1)}`}
                            onClick={() => { copy(index, account.label ?? '') }}
                          >
                            {copied === index ? t('accountCopied') : t('accountCopy')}
                          </DshButton>
                          <DshButton
                            theme="borderless"
                            type="danger"
                            size="small"
                            disabled={disabled}
                            onClick={() => { onRemove(index) }}
                          >
                            {t('accountRemove')}
                          </DshButton>
                        </>
                      )}
                </li>
              ))}
            </ul>
          )}
      <div className="dsh-failover-accounts__add">
        <DshInput
          mode="password"
          value={draftKey}
          disabled={disabled}
          // 已有账号时用当前掩码作占位：输入框不再是空白，用户能看出这一行接着哪个 key。
          placeholder={accounts.length === 0 ? t('accountKeyPlaceholder') : (rows[accounts.length - 1]?.maskedKey ?? t('accountKeyPlaceholder'))}
          aria-label={t('accountKey')}
          onChange={value => { setDraftKey(value) }}
        />
        <DshInput
          value={draftLabel}
          disabled={disabled}
          placeholder={t(labelPlaceholderKey(platform))}
          aria-label={t('accountLabel')}
          onChange={value => { setDraftLabel(value) }}
        />
        <DshButton theme="solid" size="small" disabled={!canAdd} onClick={add}>{t('accountAdd')}</DshButton>
      </div>
      <p className="dsh-failover-accounts__hint">{t('accountKeepBlank')}</p>
    </div>
  )
}
