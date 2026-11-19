/**
 * npm registry 归一（FNOS-055）。
 *
 * 历史向导里有一个 `npmMirror` 选项，值指向 npm 的只读复制存档端点
 * （`skimdb.npmjs.com`，301 到 `replicate.npmjs.com`）。该地址不提供可安装的
 * 包，选它安装必然 404；但安装回调在装 pnpm 之前就会把这个值写进应用自己的
 * `.npmrc`，所以失败安装也会把坏值留在设备上。
 *
 * 这里只做一件事：把**已知失效的地址**换成 npm 官方源。其它 registry（包括
 * 用户自建源和国内镜像）原样保留——替用户挑第三方源是另一个产品决策，不在
 * 本次修复里。
 *
 * @module install-callback-helper/npm-registry
 */

/** 归一后的默认 npm 官方源。 */
export const DEFAULT_NPM_REGISTRY = 'https://registry.npmjs.org/'

/**
 * 已知失效的 npm registry 地址。
 *
 * `skimdb.npmjs.com/registry` 是复制端点，跳转后的 `replicate.npmjs.com/registry`
 * 是只读存档；两个都按失效处理，带不带结尾斜杠、http/https、主机名大小写都算。
 * 只匹配到 `/registry` 这一层，避免误伤同主机下的其它路径。
 */
const RETIRED_REGISTRY_PATTERN = /^https?:\/\/(?:skimdb|replicate)\.npmjs\.com\/registry\/?$/iu

/**
 * 归一一个 npm registry 值。
 *
 * - 空值原样返回（由调用方决定是否回退默认值）；
 * - 已知失效地址返回 `DEFAULT_NPM_REGISTRY`；
 * - 其它值只去掉首尾空白，内容与顺序保持不变。
 *
 * 函数是幂等的：对结果再调用一次不会变化。
 *
 * @param value - 向导提交值或已持久化的 registry。
 * @returns 归一后的 registry。
 */
export function normalizeNpmRegistry(value: string): string {
  const trimmed = value.trim()
  if (trimmed === '') return trimmed
  return RETIRED_REGISTRY_PATTERN.test(trimmed) ? DEFAULT_NPM_REGISTRY : trimmed
}
