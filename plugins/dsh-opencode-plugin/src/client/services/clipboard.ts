/**
 * 剪贴板写入。
 *
 * `navigator.clipboard` 在非安全上下文或受限 iframe 里不可用，而插件详情页
 * 本身就跑在网关 iframe 内，因此保留 `execCommand` 回落，不能只赌一种实现。
 *
 * 两种实现都失败时返回 `false` 而不是抛错：调用方据此提示用户手动复制，
 * 登录链路本身不受影响。
 *
 * @module dsh-opencode/client/clipboard
 */

/**
 * 把文本写入剪贴板。
 *
 * @param text - 待复制内容。
 * @returns 是否成功；环境完全不支持剪贴板时为 `false`。
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard !== undefined) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // 权限被拒或上下文不安全：继续走回落方案。
    }
  }
  if (typeof document === 'undefined') return false
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.append(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  } catch {
    return false
  }
}
