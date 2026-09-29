#!/usr/bin/env node
/**
 * 把 CodeBuddy 分散的配置文件合并为一份文档。
 *
 * 合并之前磁盘上有 5 个文件：`codebuddy-auth.json`（账号凭据）与它的四个
 * 兄弟文件 `.auto-switch.json` / `.auto-checkin.json` / `.auto-travel.json` /
 * `.growth-run.json`。子文件挂在凭据文件名之后，读名字看不出是一组配置。
 * 本脚本把它们并进一份带 `version` 的文档。
 *
 * 大多数用户不需要手动运行：升级后插件**第一次读取**配置时会自动完成迁移。
 * 这个脚本存在的意义是离线/NAS 预迁移、批量处理，以及排错时能显式看到结果。
 *
 * 它与读时迁移**共用同一份实现**（`src/host/storage.ts` 的
 * `migrateStorageDocument`），因此两条路径不会漂移——脚本在这里只是调用方，
 * 不重复一遍文件清单与合并规则。
 *
 * 旧文件一律**改名保留**为 `<原名>.migrated-<时间戳>`，不删除：里面是账号
 * 偏好与执行日志，删除是不可逆的。
 *
 * 用法：
 *   node scripts/migrate-storage.mjs            # 迁移 $DSH_HOME 下的默认位置
 *   node scripts/migrate-storage.mjs --dry-run  # 只报告将要做什么
 *   DSH_CODEBUDDY_AUTH_FILE=/path/to/codebuddy-auth.json node scripts/migrate-storage.mjs
 *
 * @module dsh-codebuddy/migrate-storage
 */

import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const args = new Set(process.argv.slice(2))
const dryRun = args.has('--dry-run')
const help = args.has('--help') || args.has('-h')

if (help) {
  process.stdout.write([
    '把 CodeBuddy 分散的配置文件合并为一份文档。',
    '',
    '用法：',
    '  node scripts/migrate-storage.mjs [--dry-run]',
    '',
    '环境变量：',
    '  DSH_CODEBUDDY_AUTH_FILE  显式指定凭据文档路径（缺省走 DSH_HOME）',
    '',
    '旧文件会改名为 <原名>.migrated-<时间戳> 保留，不会删除。',
    '',
  ].join('\n'))
  process.exit(0)
}

/**
 * 载入插件的构建产物。
 *
 * 只认 `lib/` 而不是 `src/`：脚本随包发布，用户装的是构建产物；从源码 import
 * 需要 TypeScript 运行时，而本仓库不提供那个依赖。没有产物时明确提示先构建，
 * 而不是让 import 抛出一个看不懂的模块解析错误。
 */
async function loadStorageModule() {
  const candidates = [
    resolve(HERE, '../lib/index.js'),
    resolve(HERE, '../lib/host/storage.js'),
  ]
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue
    const module = await import(pathToFileURL(candidate).href)
    if (typeof module.migrateStorageDocument === 'function' && typeof module.getStoragePath === 'function') {
      return module
    }
  }
  process.stderr.write([
    '找不到可用的构建产物（lib/index.js）。',
    '请先在插件目录运行：pnpm run build',
    '',
  ].join('\n'))
  process.exit(2)
}

const storage = await loadStorageModule()
const path = storage.getStoragePath()

process.stdout.write(`CodeBuddy 配置文档：${path}\n`)

if (dryRun) {
  // 只探测旧兄弟文件是否存在，不写盘。
  const suffixes = ['.auto-switch.json', '.auto-checkin.json', '.auto-travel.json', '.growth-run.json']
  const found = suffixes.filter(suffix => existsSync(`${path}${suffix}`))
  if (found.length === 0) {
    process.stdout.write('没有待合并的旧配置文件；无需迁移。\n')
    process.exit(0)
  }
  process.stdout.write(`将合并 ${found.length} 个旧文件（--dry-run，未改动磁盘）：\n`)
  for (const suffix of found) process.stdout.write(`  - ${path}${suffix}\n`)
  process.stdout.write('它们会被改名为 <原名>.migrated-<时间戳> 保留。\n')
  process.exit(0)
}

const outcome = await storage.migrateStorageDocument()

if (outcome.legacyFiles.length === 0) {
  process.stdout.write('没有待合并的旧配置文件；文档已是合并状态。\n')
} else {
  process.stdout.write(`合并 ${outcome.legacyFiles.length} 个旧配置文件：\n`)
  for (const file of outcome.legacyFiles) process.stdout.write(`  - ${file}\n`)
  process.stdout.write(`已归档（改名保留）：${outcome.archived} 个\n`)
}
process.stdout.write([
  `账号数：${outcome.accounts}`,
  `自动偏好：${outcome.hasPrefs ? '已保留' : '无'}`,
  `成长任务状态：${outcome.hasGrowthRun ? '已保留' : '无'}`,
  '',
].join('\n'))
