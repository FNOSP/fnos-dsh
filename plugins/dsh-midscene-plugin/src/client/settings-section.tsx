/**
 * 插件详情页的接入设置区块（FNOS-013-05、14）。
 *
 * 承载策略（插件 UI 规范「配置项 UI 选择顺序」）：先看官方配置 UI 能否表达。
 * 本插件的 `Config` schema 已声明为 volatile，官方设置表单**确实会渲染其中的标量
 * 字段**（端口、超时、日志开关等），这些字段因此留在官方表单，不在本区块重复实现。
 *
 * 本区块只承载**官方字段原语表达不了**的三件事（依据：`@deepseek-ai/dsh-client-ui-primitives`
 * 只导出 `SettingsValueField`（文本）、`SettingsSecretField`（密钥）、`settingsNumberField`
 * （数字）三类原语，没有布尔控件、枚举下拉、对象列表，也没有按钮）：
 *
 * 1. **密钥的显示与重新生成**：需要「显示当前值 + 一个生成按钮 + 写回」，官方只有输入框，
 *    无法表达「点一下生成新值」。且密钥是 secret 角色、明文不随配置读取面跨线，必须由宿主
 *    端点按需送回（因此走 `settings` 端点读取，而不是从配置表单读）。
 * 2. **协议家族下拉**：官方没有枚举控件；让用户手打家族名会直接踩 `Invalid
 *    MIDSCENE_MODEL_FAMILY value`（Midscene 运行时校验），下拉可把可选值限死在白名单内。
 * 3. **指定模型列表**：官方没有对象/字符串列表的增行控件。
 *
 * 三者都只负责**交互**：写入仍走宿主端点 → `settings.update` → 同一份配置文档，不存在
 * 第二套配置存储。用户改动经 `liveConfig` 立即作用于运行中的桥，无需重启。
 *
 * @module dsh-midscene/client/settings-section
 */

import type { ReactNode } from 'react'
import { useCallback, useEffect, useState } from 'react'
import {
  DshButton,
  DshIconCopy,
  DshInput,
  DshSelect,
  DshTag,
} from '@tnnevol/dsh-semi-ui'
import type { MidsceneSettingsSnapshot } from '../contracts/settings-rpc.ts'
import type { MidsceneLocaleKey } from './locales.ts'

/** 设置区块参数。 */
export interface MidsceneSettingsSectionProps {
  /** 本地化函数。 */
  readonly t: (key: MidsceneLocaleKey) => string
  /** 读取当前设置（含明文密钥与 `.env` 文本）。 */
  readonly load: () => Promise<MidsceneSettingsSnapshot>
  /** 提交一次设置写入，返回写入后的真实状态。 */
  readonly update: (request: Record<string, unknown>) => Promise<MidsceneSettingsSnapshot>
}

/** 区块根节点类名（样式在 plugin-ui 语义变量下维护）。 */
const ROOT = 'dsh-midscene-settings'

/**
 * 逐字段渲染一个设置项。
 * @param props - 字段参数。
 * @param props.label - 字段标题。
 * @param props.hint - 字段说明（可选）。
 * @param props.children - 控件内容。
 * @returns 字段区块。
 */
function Field({ label, hint, children }: { label: string, hint?: string, children: ReactNode }): ReactNode {
  return (
    <div className={`${ROOT}__field`}>
      <div className={`${ROOT}__label`}>{label}</div>
      <div className={`${ROOT}__control`}>{children}</div>
      {hint === undefined ? null : <div className={`${ROOT}__hint`}>{hint}</div>}
    </div>
  )
}

/**
 * 接入设置区块。
 * @param props - 区块参数。
 * @param props.t - 本地化函数。
 * @param props.load - 读取当前设置（含明文密钥与 `.env` 文本）。
 * @param props.update - 提交一次设置写入。
 * @returns 设置区块。
 */
export function MidsceneSettingsSection({ t, load, update }: MidsceneSettingsSectionProps): ReactNode {
  const [snapshot, setSnapshot] = useState<MidsceneSettingsSnapshot | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [customKey, setCustomKey] = useState('')
  const [editingKey, setEditingKey] = useState(false)
  const [model, setModel] = useState('')
  // 只看支持图片的模型（默认开启）：Midscene 靠截图理解页面，文本模型选进来也跑不了。

  /** 读一次状态（失败呈现为可重试的错误，不静默留空）。 */
  const reload = useCallback(async (): Promise<void> => {
    try {
      const next = await load()
      setSnapshot(next)
      setModel(next.model)
      setError(undefined)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [load])

  useEffect(() => { void reload() }, [reload])

  /** 提交一次写入并用返回的真实状态校正界面。 */
  const submit = useCallback(async (request: Record<string, unknown>): Promise<void> => {
    setBusy(true)
    try {
      const next = await update(request)
      setSnapshot(next)
      setModel(next.model)
      setError(undefined)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }, [update])

  if (error !== undefined && snapshot === undefined) {
    return (
      <div className={ROOT}>
        <div className={`${ROOT}__title`}>{t('sectionTitle')}</div>
        <div className={`${ROOT}__error`}>{t('loadFailed')}: {error}</div>
        <DshButton size="small" onClick={() => { void reload() }}>{t('reload')}</DshButton>
      </div>
    )
  }

  if (snapshot === undefined) {
    return (
      <div className={ROOT}>
        <div className={`${ROOT}__title`}>{t('sectionTitle')}</div>
        <div className={`${ROOT}__hint`}>{t('loading')}</div>
      </div>
    )
  }

  // 可选模型 = 宿主给出的**可识图模型**清单（宿主已过滤掉无图片能力的模型：Midscene 靠
  // 截图理解页面，文本模型选进来也跑不了）。
  const selectableModels = snapshot.availableModels
  // 已指定但当前目录里没有的模型：如实提示，不静默改选别的（可能是提供方被卸载或改名）。
  const modelMissing = model !== '' && !selectableModels.some(entry => entry.id === model)
  // 一个可识图模型都没有：不渲染空下拉（那看起来像坏了），改为给出可操作的提示。
  const noModels = snapshot.availableModels.length === 0

  const copyEnv = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(snapshot.envFile)
      setCopied(true)
      window.setTimeout(() => { setCopied(false) }, 1500)
    } catch {
      // 剪贴板不可用（无权限/非安全上下文）时不改界面状态：用户仍可手动复制。
    }
  }

  /**
   * 提交模型选择。
   *
   * 只选一个：Midscene 的协议家族在启动期从 `.env` 读取且只有一个，多选若混入不同
   * 系列的模型，回退到备用时家族仍是旧的，反而制造静默错位。既然任何时刻只可能有一个
   * 模型生效，界面就如实只让选一个。
   * @param next - 新选择的模型 id；空串表示跟随 DSH 当前会话模型。
   */
  const applyModel = (next: string): void => {
    setModel(next)
    void submit({ action: 'update', model: next })
  }

  return (
    <div className={ROOT}>
      <div className={`${ROOT}__title`}>{t('sectionTitle')}</div>
      <div className={`${ROOT}__hint`}>{t('sectionHint')}</div>

      <Field label={t('apiKeyLabel')} hint={t('apiKeyHint')}>
        <code className={`${ROOT}__key`}>{snapshot.apiKey}</code>
        <DshButton
          size="small"
          loading={busy}
          onClick={() => { void submit({ action: 'regenerate' }) }}
        >
          {busy ? t('regenerating') : t('regenerate')}
        </DshButton>
        <DshButton size="small" onClick={() => { setEditingKey(!editingKey); setCustomKey('') }}>
          {t('customKey')}
        </DshButton>
      </Field>

      {!editingKey ? null : (
        <Field label={t('customKey')}>
          <DshInput
            size="small"
            style={{ width: 320 }}
            value={customKey}
            placeholder={t('customKeyPlaceholder')}
            onChange={(value: string) => { setCustomKey(value) }}
          />
          <DshButton
            size="small"
            theme="solid"
            disabled={customKey.trim() === ''}
            loading={busy}
            onClick={() => {
              void submit({ action: 'setKey', apiKey: customKey.trim() }).then(() => { setEditingKey(false) })
            }}
          >
            {busy ? t('saving') : t('save')}
          </DshButton>
          <DshButton size="small" onClick={() => { setEditingKey(false) }}>{t('cancel')}</DshButton>
        </Field>
      )}

      <Field label={t('modelsLabel')} hint={t('modelsHint')}>
        {noModels ? (
          /* 一个可识图模型都没有：给可操作的提示而不是空下拉（空下拉看起来像坏了）。 */
          <span className={`${ROOT}__hint`}>{t('modelsUnavailable')}</span>
        ) : (
          <>
            <DshSelect
              filter
              showClear
              size="small"
              style={{ width: 420 }}
              value={model === '' ? undefined : model}
              placeholder={t('modelsNoneSelected')}
              onChange={(value?: string) => { applyModel(value ?? '') }}
            >
              {selectableModels.map(entry => (
                <DshSelect.Option key={entry.id} value={entry.id}>
                  {entry.name === undefined ? entry.id : `${entry.name} · ${entry.id}`}
                </DshSelect.Option>
              ))}
            </DshSelect>
            {modelMissing ? (
              <DshTag color="orange" size="small">{t('modelsStale')}: {model}</DshTag>
            ) : null}
          </>
        )}
      </Field>

      <Field label={t('envLabel')} hint={t('envHint')}>
        <DshButton size="small" icon={<DshIconCopy />} onClick={() => { void copyEnv() }}>
          {copied ? t('copied') : t('envCopy')}
        </DshButton>
        <pre className={`${ROOT}__env`}>{snapshot.envFile}</pre>
      </Field>

      {error === undefined ? null : (
        <div className={`${ROOT}__error`}>{t('saveFailed')}: {error}</div>
      )}
    </div>
  )
}
