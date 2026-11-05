/**
 * 安装期 Node 运行时下限校验（FNOS-046）。
 *
 * DSH 0.2.2 把 `engines.node` 收紧为 `>=24.9.0`，而本应用不内置 Node，用的是
 * fnOS 系统包 `nodejs_v24`。此前安装脚本只判断 Node 可执行文件存在：版本不足时
 * npm 只发 `EBADENGINE` 警告，安装「成功」，失败被推到启动阶段（命令行自检或
 * Web 健康检查 120s 超时），用户看到的是「装完起不来」。
 *
 * 这里把它前移到安装期：版本不足直接失败，并给出可执行的处理方向。
 *
 * @module install-callback-helper/node-version
 */

import { createLogger, fail } from './logger.ts'

const logger = createLogger('node-version')

/** 解析 `v24.15.0` / `24.15.0` 形式的三段版本；非法时返回 undefined。 */
export function parseNodeVersion(value: string): [number, number, number] | undefined {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/u.exec(value.trim())
  if (match === null) return undefined
  const [, major, minor, patch] = match
  return [Number(major), Number(minor), Number(patch)]
}

/** `actual` 低于 `required` 返回 -1，相等返回 0，高于返回 1；任一侧非法时返回 undefined。 */
export function compareNodeVersion(actual: string, required: string): number | undefined {
  const left = parseNodeVersion(actual)
  const right = parseNodeVersion(required)
  if (left === undefined || right === undefined) return undefined
  for (let index = 0; index < 3; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0)
    if (difference !== 0) return difference < 0 ? -1 : 1
  }
  return 0
}

/**
 * 校验当前 Node 是否达到运行时下限。
 *
 * `actual` 默认取 `process.version`：调用方的 helper 正是用系统 Node 执行的，
 * 因此不需要再单独探测可执行文件版本。
 *
 * @throws InstallHelperError 版本低于下限或版本串无法解析时抛出，消息面向使用者。
 */
export function assertNodeFloor(required: string, actual: string = process.version): void {
  if (parseNodeVersion(required) === undefined) {
    return fail('node-version', `nodejs_v24 的最低版本配置非法：${required}`)
  }
  const order = compareNodeVersion(actual, required)
  if (order === undefined) {
    return fail('node-version', `无法解析系统 Node 版本「${actual}」，请确认 nodejs_v24 安装完整后重试`)
  }
  if (order < 0) {
    return fail(
      'node-version',
      `系统 Node 版本过低：当前 ${actual}，DSH 运行时要求 >= ${required}。`
      + '请在 fnOS 应用中心把 nodejs_v24 升级到该版本或更高，然后重新安装本应用。',
    )
  }
  logger.info(`nodejs_v24 ${actual} satisfies >= ${required}.`)
}
