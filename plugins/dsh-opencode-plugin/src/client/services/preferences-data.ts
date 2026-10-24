/**
 * 插件偏好的浏览器侧存储。
 *
 * 偏好本身落在宿主文件（`.dsh-opencode-preferences.json`），但详情页与输入区
 * 胶囊是两个独立座位，需要一个共享、可订阅的读取面：账号卡片之外的设置区块
 * 与胶囊必须同时看到「刚刚保存」的值。
 *
 * 这里用 `useSyncExternalStore` 兼容的轻量 store：一次请求、多处分发；写入走
 * 乐观更新，失败回滚并抛出，界面据此显示可读错误。
 *
 * @module dsh-opencode/client/preferences
 */

import { OPENCODE_ROUTES } from '../../contracts/routes.ts'
import { DEFAULT_OPENCODE_PREFERENCES, normalizePreferences } from '../../contracts/preferences.ts'
import type { OpenCodePreferences } from '../../contracts/preferences.ts'
import { requestJson } from './http.ts'

/** store 快照：值 + 是否已完成首次读取。 */
export interface OpenCodePreferencesSnapshot {
  readonly value: OpenCodePreferences
  readonly loaded: boolean
}

/** 详情页与胶囊共享的偏好读取面。 */
export interface OpenCodePreferencesStore {
  /** 当前快照；引用只在变化时更换，可直接交给 `useSyncExternalStore`。 */
  getSnapshot(): OpenCodePreferencesSnapshot
  /** 订阅变化；返回取消订阅函数。 */
  subscribe(listener: () => void): () => void
  /** 首次读取（并发调用共享同一个请求）。 */
  ensureLoaded(): Promise<OpenCodePreferences>
  /** 丢弃缓存并重新读取。 */
  reload(): Promise<OpenCodePreferences>
  /** 写入部分字段；乐观更新，失败回滚并抛出。 */
  save(patch: Partial<OpenCodePreferences>): Promise<OpenCodePreferences>
}

/** 两份偏好是否等价；隐藏列表按顺序比较（服务端会去重但保留顺序）。 */
function samePreferences(left: OpenCodePreferences, right: OpenCodePreferences): boolean {
  if (left.usageVisibility !== right.usageVisibility) return false
  if (left.refreshMinutes !== right.refreshMinutes) return false
  if (left.endpointPlan !== right.endpointPlan) return false
  if (left.hiddenModels.length !== right.hiddenModels.length) return false
  return left.hiddenModels.every((id, index) => id === right.hiddenModels[index])
}

/**
 * 创建偏好 store。
 *
 * 每次 `apply` 只创建一个实例，注入详情页与胶囊；测试可以独立创建。
 *
 * @returns 可订阅的偏好 store。
 */
export function createPreferencesStore(): OpenCodePreferencesStore {
  let snapshot: OpenCodePreferencesSnapshot = { value: DEFAULT_OPENCODE_PREFERENCES, loaded: false }
  const listeners = new Set<() => void>()
  let pending: Promise<OpenCodePreferences> | undefined

  const publish = (next: OpenCodePreferencesSnapshot): void => {
    if (next.loaded === snapshot.loaded && samePreferences(next.value, snapshot.value)) return
    snapshot = next
    for (const listener of [...listeners]) listener()
  }

  const load = async (): Promise<OpenCodePreferences> => {
    const raw = await requestJson<unknown>(OPENCODE_ROUTES.preferences)
    const value = normalizePreferences(raw)
    publish({ value, loaded: true })
    return value
  }

  const ensureLoaded = (): Promise<OpenCodePreferences> => {
    if (snapshot.loaded) return Promise.resolve(snapshot.value)
    pending ??= load().finally(() => { pending = undefined })
    return pending
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    ensureLoaded,
    reload() {
      pending = undefined
      return load()
    },
    async save(patch) {
      const previous = snapshot
      // 首次读取尚未完成时先补读，避免乐观值用默认值覆盖用户已有的隐藏列表。
      // 读取失败不阻塞写入：宿主按「读磁盘 + 合并补丁」处理，补丁本身仍然安全。
      if (!previous.loaded) await ensureLoaded().catch(() => undefined)
      const optimistic = normalizePreferences({ ...snapshot.value, ...patch })
      publish({ value: optimistic, loaded: snapshot.loaded })
      try {
        const raw = await requestJson<unknown>(OPENCODE_ROUTES.preferences, 'PUT', patch)
        const value = normalizePreferences(raw)
        publish({ value, loaded: true })
        return value
      } catch (error) {
        publish(previous)
        throw error
      }
    },
  }
}
