/**
 * 发布前鉴权自检。
 *
 * 这道检查存在的原因是一个反复发生的真实混淆：`pnpm login` **不会**替 `npm publish`
 * 完成认证。两个工具读不同的配置——实测 macOS 上 pnpm 11 把 token 写进
 * `~/Library/Preferences/pnpm/config.yaml`，而 npm 读 `~/.npmrc`；两边可能各存着
 * 不同（甚至一旧一新）的 token。
 *
 * 本仓库的发布流程**必须**用 `npm publish`：只有 pnpm 会解析 `catalog:` 协议，
 * 所以先 `pnpm pack` 产出 tgz，再交给 npm 上传。于是「pnpm 已登录」不等于「能发布」。
 *
 * 不检查时的症状极难自解释：npm 对无权限的 PUT 返回 **E404 Not Found**（而不是 401），
 * 文案是「could not be found or you do not have permission」，看起来像包不存在。
 *
 * @module fnos-dsh-cli/npm-auth
 */

import { execFile } from 'node:child_process'

/**
 * 以指定 CLI 查询当前登录用户。
 *
 * @param command - `npm` 或 `pnpm`。
 * @returns 成功时的用户名；未登录、未安装或超时返回 `undefined`。
 */
async function whoami(command: string): Promise<string | undefined> {
  try {
    // 刻意用**回调式**而不用 `promisify(execFile)`：`promisify` 在调用时就取定
    // `execFile` 的自定义实现，测试里替换 `execFile` 后 promisify 仍指向原函数，
    // 于是桩返回的 Promise 永不回调、用例静默挂到超时（本仓库已踩过一次）。
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile(command, ['whoami'], { timeout: 30_000 }, (error, output) => {
        if (error !== null) reject(error)
        else resolve(output)
      })
    })
    const user = stdout.trim()
    return user.length > 0 ? user : undefined
  } catch {
    return undefined
  }
}

/** 发布前自检的结果。 */
export interface PublishAuthCheck {
  /** npm 是否可用；`false` 时给出可执行的修复指引。 */
  readonly ok: boolean
  /** 面向使用者的说明（失败时为多行指引）。 */
  readonly message: string
}

/**
 * 检查 `npm` 是否已登录，供发布前快速失败。
 *
 * 关键分支：npm 未登录而 pnpm 已登录时，直接给出**把 pnpm 的 token 同步给 npm** 的
 * 命令——这正是本检查要消除的那一步人工推断。
 *
 * @returns 自检结果；`ok` 为假时调用方应立即停止发布。
 */
export async function checkPublishAuth(): Promise<PublishAuthCheck> {
  const npmUser = await whoami('npm')
  if (npmUser !== undefined) {
    return { ok: true, message: `npm 已登录：${npmUser}` }
  }

  const pnpmUser = await whoami('pnpm')
  if (pnpmUser !== undefined) {
    return {
      ok: false,
      message: [
        `npm 未登录，但 pnpm 已登录（${pnpmUser}）——两者读不同的配置，pnpm login 不会替 npm 认证。`,
        '发布用的是 npm（只有 pnpm 能解析 catalog:，所以包由 pnpm 打、由 npm 传）。',
        '把 pnpm 的凭据同步给 npm 后再发布：',
        '  npm config set //registry.npmjs.org/:_authToken "$(pnpm config get //registry.npmjs.org/:_authToken)"',
        '  npm whoami   # 应打印你的用户名',
      ].join('\n'),
    }
  }

  return {
    ok: false,
    message: [
      'npm 未登录，且 pnpm 也未登录。先登录其一：',
      '  npm login',
      '  然后确认：npm whoami',
    ].join('\n'),
  }
}
