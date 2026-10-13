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
  const [models, setModels] = useState<string[]>([])
  // 只看支持图片的模型（默认开启）：Midscene 靠截图理解页面，文本模型选进来也跑不了。

  /** 读一次状态（失败呈现为可重试的错误，不静默留空）。 */
  const reload = useCallback(async (): Promise<void> => {
    try {
      const next = await load()
      setSnapshot(next)
      setModels([...next.models])
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
      setModels([...next.models])
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
  // 截图理解页面，文本模型选进来也跑不了）。已选中的项始终保留，否则用户看不到自己选了
  // 什么、也无法取消。
  const selectableModels = snapshot.availableModels.filter(model =>
    model.vision || models.includes(model.id))
  // 已配置但当前目录里没有的模型：如实提示，不静默丢弃（可能是提供方被卸载或模型改名）。
  const availableIds = new Set(snapshot.availableModels.map(model => model.id))
  const staleModels = models.filter(id => !availableIds.has(id))
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
   * 下拉的多选值直接就是完整列表（含顺序），因此一次提交整组：不做增量增删，
   * 避免「先删后加」两次写入之间出现短暂的空列表。去重由 `DshSelect` 保证，
   * 这里再兜一次以防目录里出现重复 id。
   */
  const applyModels = (next: readonly string[]): void => {
    const deduped = [...new Set(next)]
    setModels(deduped)
    void submit({ action: 'update', models: deduped })
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
              multiple
              filter
              size="small"
              style={{ width: 420 }}
              value={models}
              placeholder={models.length === 0 ? t('modelsNoneSelected') : t('modelsPlaceholder')}
              onChange={(value: string[]) => { applyModels(value) }}
            >
              {selectableModels.map(model => (
                <DshSelect.Option key={model.id} value={model.id}>
                  {model.name === undefined ? model.id : `${model.name} · ${model.id}`}
                </DshSelect.Option>
              ))}
            </DshSelect>
            {staleModels.length === 0 ? null : (
              <DshTag color="orange" size="small">
                {t('modelsStale')}: {staleModels.join(', ')}
              </DshTag>
            )}
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
