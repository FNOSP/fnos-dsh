/**
 * `semver` 的最小类型声明。
 *
 * 为什么需要它：`semver@7` 本身不带类型定义，而 `@types/semver` 不在本仓库的
 * 依赖树里（离线安装取不到）。这里**只声明实际用到的两个函数**，不重新实现任何
 * 比较逻辑——版本判定的规格仍由 `semver` 本体负责。
 *
 * 若将来 `@types/semver` 进入依赖树，删掉本文件即可。
 *
 * @module dsh-fnos/types/semver
 */

declare module 'semver' {
  /**
   * 规范化版本串；不合法时返回 `null`。
   * @param version - 待校验的版本串。
   * @returns 规范化后的版本串或 null。
   */
  export function valid(version: string): string | null

  /**
   * 判断 `v1` 是否严格大于 `v2`（semver 优先级规则）。
   * @param v1 - 左侧版本。
   * @param v2 - 右侧版本。
   * @returns `v1 > v2` 时为 true。
   */
  export function gt(v1: string, v2: string): boolean
}
