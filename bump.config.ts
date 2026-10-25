import { defineConfig } from 'bumpp'

/**
 * bumpp 配置：版本维护直接由 bumpp CLI 驱动（`pnpm run version` 转发），
 * 本文件承载仓库侧约定（FNOS-028）：
 *
 * - `files`：项目版本出现的全部文件。bumpp 对 package.json 走 manifest 更新
 *   （只改顶层 version），其余为文本替换（当前版本串 → 新版本）。
 * - `execute`：bumpp 替换完 files、**提交之前**执行——插件同号写入、发布清单
 *   副本、总览表格与安装命令、manifest/应用文档页基线字样都在这里同步，
 *   并把同步产物 `git add` 进暂存区（local-only 插件路径除外）；随后的
 *   commit 以 all 模式把暂存与替换收进同一条 `chore: release v<版本>` 提交。
 * - `release: 'prompt'`：无位置参数时弹 bumpp 原生菜单（各档位预览 + custom）。
 * - `push: false`：tag 只留本地，推送由发布者手动执行。
 * - 仓库守卫（档位语义、baseline 仅 major、同号核对、工作区干净）在转发层
 *   （`fnos-dsh-cli version`）完成，bumpp 拿到的已是合规参数。
 */
export default defineConfig({
  release: 'prompt',
  files: [
    'package.json',
    'docs/package.json',
    'packages/**/package.json',
    'tooling/fnos-dsh-cli/package.json',
    'apps/**/manifest',
    'docs/development/manifest.md',
    'docs/apps/fn-deepseek-harness.md',
    'README.md',
  ],
  commit: true,
  tag: true,
  push: false,
  all: true,
  // 根 package.json 的 `version` script 就是本入口（fnos-dsh-cli version）；bumpp
  // 的 npm 钩子链（preversion/version/postversion）会执行它，而此时 files 已被
  // 替换、工作区变脏，递归入口被干净守卫拒绝，形成死循环式失败。必须禁用钩子——
  // 仓库侧同步由下方 execute 承担，不依赖 npm script。
  ignoreScripts: true,
  execute: 'pnpm exec fnos-dsh-cli version-sync',
})
