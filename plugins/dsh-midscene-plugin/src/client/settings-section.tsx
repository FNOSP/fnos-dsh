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
  DshCheckbox,
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
  const [visionOnly, setVisionOnly] = useState(true)
  // 换家族时清掉了不兼容的模型：给一次提示，让「我的选择怎么少了」有解释。
  const [familyCleared, setFamilyCleared] = useState(false)

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

  // 家族未选择时**不展示模型字段**：模型按家族过滤，没有家族就没有「可选模型」这个概念，
  // 显示一个空下拉只会让人以为功能坏了（需求：未选 family 则不显示模型字段）。
  const familySelected = snapshot.family.trim() !== ''

  // 按家族过滤后再按视觉能力过滤。家族信息由宿主算出（`model.family`），界面不重复实现映射。
  // 已选中的项始终保留，否则用户看不到自己选了什么、也无法取消。
  const selectableModels = snapshot.availableModels.filter((model) => {
    if (familySelected && model.family !== snapshot.family) return false
    return !visionOnly || model.vision || models.includes(model.id)
  })
  // 已配置但当前目录里没有的模型：如实提示，不静默丢弃（可能是提供方被卸载或模型改名）。
  const availableIds = new Set(snapshot.availableModels.map(model => model.id))
  const staleModels = models.filter(id => !availableIds.has(id))
  // 已选中但不属于当前家族的模型：切换家族时会自动移除，这里同步提示原因。
  const offFamilyModels = familySelected
    ? models.filter((id) => {
      const model = snapshot.availableModels.find(candidate => candidate.id === id)
      return model !== undefined && model.family !== snapshot.family
    })
    : []

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
   * 提交家族变更，并**一并**提交过滤后的模型。
   *
   * 家族与模型是一致性约束的两端：只改家族会留下「新家族 + 旧家族的模型」这种静默错位
   * 组合（实测过这种配置）。因此这里算出仍属于新家族的模型一起提交——宿主也会做同样的
   * 剔除，两边行为一致。
   * @param family - 新家族。
   */
  const applyFamily = (family: string): void => {
    const kept = models.filter((id) => {
      const model = snapshot?.availableModels.find(candidate => candidate.id === id)
      // 目录里查不到的（已卸载/改名）不因换家族而被清掉：那不是「家族不符」，
      // 而是「暂不可用」，用户可能只是暂时卸载了提供方。
      return model === undefined || model.family === family
    })
    setModels(kept)
    if (kept.length < models.length) setFamilyCleared(true)
    void submit({ action: 'update', family, models: kept })
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
    setFamilyCleared(false)
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

      <Field label={t('familyLabel')} hint={t('familyHint')}>
        <DshSelect
          size="small"
          // 限宽走组件自身的 style（Semi 公开 API）：不限宽时下拉会撑满整行。
          // 不在插件内针对 `.semi-*` 写覆盖——主题类调整归共享包（插件 UI 规范）。
          style={{ width: 260 }}
          value={familySelected ? snapshot.family : undefined}
          placeholder={t('familyPlaceholder')}
          onChange={(value: string) => { void applyFamily(value) }}
        >
          {snapshot.families.map(family => (
            <DshSelect.Option key={family} value={family}>{family}</DshSelect.Option>
          ))}
        </DshSelect>
        {snapshot.families.includes(snapshot.family)
          ? null
          : <DshTag color="red" size="small">{snapshot.family === '' ? t('familyRequired') : t('familyInvalid')}</DshTag>}
      </Field>

      {familySelected ? (
      <Field label={t('modelsLabel')} hint={t('modelsHintFiltered')}>
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
              {/* 无图片能力的选项标注出来：Midscene 需要视觉能力，选错只会在跑的时候才失败。 */}
              {model.vision ? model.id : `${model.id} · ${t('modelsNoVision')}`}
            </DshSelect.Option>
          ))}
        </DshSelect>
        <DshCheckbox
          checked={visionOnly}
          // Semi 的 Checkbox onChange 传的是事件对象而非布尔值（与仓库既有用法一致，
          // 见展示插件的示例）：受控组件直接翻转自身状态即可，不用读事件参数。
          onChange={() => { setVisionOnly(value => !value) }}
        >
          {t('modelsVisionOnly')}
        </DshCheckbox>
        {staleModels.length === 0 ? null : (
          <DshTag color="orange" size="small">
            {t('modelsStale')}: {staleModels.join(', ')}
          </DshTag>
        )}
        {!familyCleared || offFamilyModels.length === 0 ? null : (
          <DshTag color="orange" size="small">{t('modelsFamilyCleared')}</DshTag>
        )}
      </Field>
      ) : (
        <Field label={t('modelsLabel')} hint={t('modelsNeedFamily')}>
          {/* 未选家族时不渲染下拉：模型按家族过滤，无家族即无可选项。 */}
          <span className={`${ROOT}__hint`}>{t('modelsNeedFamily')}</span>
        </Field>
      )}

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
