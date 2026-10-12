/**
 * 浏览器半侧：插件详情页的 Midscene 接入设置区块。
 *
 * 座位选 `plugins.detail.section`，与仓库内其余插件一致：上游 `PackageDetail` 的固定
 * 顺序是 `bundle.config` → 「包含的组件」→ `plugins.detail.section`，只有这个座位能出现在
 * 组件列表**之后**。该座位是 **list**（非 keyed），页面会给打开的每个详情页都渲染它，
 * 因此必须自己判断 `subject`——不是本插件的组合包就返回 `null`，否则这段界面会出现在别的
 * 插件详情页上。
 *
 * 官方设置表单（由 `Config` schema 自动投影）已经承载标量字段，本区块只补官方字段原语
 * 表达不了的交互（密钥生成、家族下拉、模型列表），写入仍落到同一份配置文档。
 *
 * @module dsh-midscene/client
 */

import '../styles/index.scss'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { installSemiDshTheme } from '@tnnevol/dsh-semi-ui'
import { MIDSCENE_PACKAGE_NAME, MIDSCENE_SETTINGS_STATUS_PATH, MIDSCENE_SETTINGS_UPDATE_PATH } from '../contracts/settings-rpc.ts'
import type { MidsceneSettingsSnapshot } from '../contracts/settings-rpc.ts'
import { en, zh } from './locales.ts'
import type { MidsceneLocaleKey } from './locales.ts'
import { MidsceneSettingsSection } from './settings-section.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'plugins.midscene': MidsceneLocaleKey
  }
}

/** Cordis 客户端插件名。 */
export const name = 'dsh-midscene-plugin-client'

/** 需要的客户端服务。 */
export const inject = ['slots', 'locale']

/** 文案命名空间。 */
const NS = 'plugins.midscene'

/** 请求设置端点；非 2xx 时把宿主给出的原因作为错误抛出（界面据此显示可读提示）。 */
async function requestSettings(path: string, init?: RequestInit): Promise<MidsceneSettingsSnapshot> {
  const response = await fetch(path, {
    headers: { accept: 'application/json', ...init?.body === undefined ? {} : { 'content-type': 'application/json' } },
    credentials: 'same-origin',
    ...init,
  })
  const payload: unknown = await response.json().catch(() => undefined)
  if (!response.ok) {
    const message = typeof payload === 'object' && payload !== null && 'error' in payload && typeof payload.error === 'string'
      ? payload.error
      : `HTTP ${response.status}`
    throw new Error(message)
  }
  return payload as MidsceneSettingsSnapshot
}

/**
 * 挂载接入设置区块。
 * @param ctx - 浏览器插件上下文。
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => installSemiDshTheme(), 'dsh-midscene: Semi DSH theme')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-midscene: locale')
  const t = ctx.locale.bind(NS) as (key: MidsceneLocaleKey) => string

  const load = (): Promise<MidsceneSettingsSnapshot> => requestSettings(MIDSCENE_SETTINGS_STATUS_PATH)
  const update = (body: Record<string, unknown>): Promise<MidsceneSettingsSnapshot> =>
    requestSettings(MIDSCENE_SETTINGS_UPDATE_PATH, { method: 'POST', body: JSON.stringify(body) })

  ctx.slots.inject('plugins.detail.section', () => ctx.slots.register({
    name: 'plugins.detail.section',
    id: 'dsh-midscene',
    order: 60,
  }, (props: { subject?: MidsceneSubject }) => {
    // list 座位：非本插件详情页必须返回 null，否则界面会串到别的插件页面上。
    if (props.subject === undefined) return null
    if (props.subject.kind !== 'bundle') return null
    if (props.subject.pkg?.name !== MIDSCENE_PACKAGE_NAME) return null
    return <MidsceneSettingsSection t={t} load={load} update={update} />
  }))
}

/** `plugins.detail.section` 的 owner props 子集。 */
interface MidsceneSubject {
  readonly kind?: string
  readonly pkg?: { readonly name?: string } | undefined
}
