/**
 * 用 fnOS 的页面能力打开外部地址。
 *
 * ## 为什么不用 `<a target="_blank">`
 *
 * 应用通常跑在 fnOS 统一网关的 iframe 里。裸 `<a target="_blank">` 在那里会
 * 被宿主拦成「新标签页」，表现取决于 WebView 实现；移动 WebView 宿主更是直接
 * 打不开。官方为此提供了 `openURL`：Web 宿主走 `window.open`，移动 WebView
 * 宿主改用系统浏览器，行为由平台保证。
 *
 * ## 失败不抛错
 *
 * 打开授权页是「给用户一个入口」，不是数据操作。SDK 不可用（本地开发、被宿主
 * 拒绝）时静默失败即可——调用方已经把地址显示在同一句话里，用户仍能自行复制。
 *
 * @module dsh-fnos/client/services/open-url
 */

import { createTrimApp } from './sdk.ts'
import { log } from '../logger.ts'

/**
 * 打开一个外部地址。
 * @param url - 目标地址。
 * @param target - 打开方式，默认 `_blank`（新标签页 / 系统浏览器）。
 * @returns 是否成功调用到 SDK。
 */
export async function openExternalUrl(url: string, target = '_blank'): Promise<boolean> {
  try {
    const sdk = createTrimApp()
    await sdk.ready()
    await sdk.openURL(url, target)
    return true
  } catch (error: unknown) {
    log.warn('unable to open the authorize page with the fnOS SDK', error)
    return false
  }
}
