/** fnOS theme bridge used after the DSH theme service has initialized. */

import type { PlatformConfig } from '@trimjs/web-app'
import { createTrimApp } from './sdk.ts'
import { isFnosTheme, type FnosTheme } from '../../contracts/theme-contract.ts'
import { log } from '../logger.ts'

export type { FnosTheme } from '../../contracts/theme-contract.ts'

export interface ThemeBridge {
  getTheme(): FnosTheme | null
  subscribe(listener: (theme: FnosTheme | null) => void): () => void
  connect(): Promise<() => void | Promise<void>>
  disconnect(): void | Promise<void>
}

function normalizeTheme(value: unknown): FnosTheme | null {
  if (isFnosTheme(value)) return value
  if (Array.isArray(value)) return normalizeTheme(value[0])
  if (!value || typeof value !== 'object') return null
  const config = value as Record<string, unknown>
  return normalizeTheme(
    config.theme
      ?? config.nightMode
      ?? config.mode
      ?? config.value
      ?? config.detail
      ?? config.data,
  )
}

function themeFromConfig(config: PlatformConfig): FnosTheme | null {
  return normalizeTheme(config)
}

/**
 * Create a bridge without changing the browser's native theme state during
 * module loading. DSH owns the first render; the plugin applies fnOS's theme
 * to the document only after the SDK connection has supplied its real state.
 */
export function createThemeBridge(): ThemeBridge {
  const themeSubscribers = new Set<(theme: FnosTheme | null) => void>()
  let activeTheme: FnosTheme | null = null
  let connectionStarted = false
  let connectionStop: (() => void | Promise<void>) | null = null
  let connectionGeneration = 0

  function setTheme(...values: unknown[]): boolean {
    const theme = values.map(normalizeTheme).find(Boolean) ?? null
    if (theme === null || activeTheme === theme) return theme !== null
    activeTheme = theme
    for (const listener of [...themeSubscribers]) listener(activeTheme)
    return true
  }

  async function connect(): Promise<() => void | Promise<void>> {
    if (connectionStarted) return connectionStop ?? (() => {})
    const generation = ++connectionGeneration
    connectionStarted = true

    try {
      const sdk = createTrimApp()
      await sdk.ready()
      /*
        **只有真正的独立浏览器页面才跳过主题桥。**

        `isWeb === false` 表示 SDK 走了 mobile / 原生宿主分支（init 里检出
        `flutter_inappwebview` 或 osConnector）——那时 `getPlatformConfig()`
        与 `$on('os/theme')` 恰恰是可用的，跳过反而丢了跟随系统主题的能力。

        早前写成 `!sdk.isWeb || sdk.isStandaloneWeb`，把这两件事混成一件事。
      */
      if (sdk.isWeb && sdk.isStandaloneWeb) {
        if (generation === connectionGeneration) connectionStarted = false
        return () => {}
      }

      const config = await sdk.getPlatformConfig()
      if (generation !== connectionGeneration) return () => {}
      setTheme(themeFromConfig(config))

      const handleThemeEvent = (...values: unknown[]): void => {
        if (generation === connectionGeneration) setTheme(...values)
      }
      await sdk.$on('os/theme', handleThemeEvent)
      if (generation !== connectionGeneration) {
        await sdk.$off('os/theme', handleThemeEvent)
        return () => {}
      }

      connectionStop = async () => {
        if (connectionStop === null) return
        connectionStop = null
        connectionStarted = false
        connectionGeneration += 1
        await sdk.$off('os/theme', handleThemeEvent)
      }
      return connectionStop
    } catch (error) {
      if (generation === connectionGeneration) connectionStarted = false
      log.warn('fnOS theme bridge unavailable', error)
      return () => {}
    }
  }

  return {
    getTheme: () => activeTheme,
    subscribe(listener) {
      themeSubscribers.add(listener)
      return () => themeSubscribers.delete(listener)
    },
    connect,
    disconnect() {
      connectionGeneration += 1
      if (connectionStop !== null) return connectionStop()
      connectionStarted = false
      return Promise.resolve()
    },
  }
}
