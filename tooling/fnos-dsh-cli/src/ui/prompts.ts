import { cancel, confirm, isCancel, multiselect } from '@clack/prompts'
import { pluginTargets, type PluginTarget } from '../config/targets.js'
import type { FpkApp } from '../config/workspace.js'
import { FPK_PLATFORMS, isFpkPlatform, parseFpkPlatforms, type FpkPlatform } from '../core/fpk-platform.js'

export type BuildSelection = 'plugins' | 'fpk' | 'docs'
export type StartSelection = 'docs' | 'plugins' | 'web'
export type CheckSelection = 'sdd' | 'docs' | 'packages' | 'plugins' | 'tooling'

export async function askPlugin(): Promise<PluginTarget[] | undefined> {
  const result = await multiselect({
    message: '选择要维护版本的插件（可多选）',
    required: true,
    options: pluginTargets.map(target => ({ value: target.value, label: target.label })),
  })
  if (isCancel(result)) {
    cancel('已取消版本维护')
    return undefined
  }
  const selected = new Set(result as string[])
  return pluginTargets.filter(target => selected.has(target.value))
}

/**
 * 把基线版本推到「下一个」。
 *
 * 只递增最后一段，保留其余部分：`0.2.1-rc.2` → `0.2.1-rc.3`。DSH 发布节奏通常是
 * 同一 minor 内连续推 rc，所以这是最常见的下一个版本号。最后一段不是数字时（极少见）
 * 原样返回，让 placeholder 退化成「当前值」，用户仍能自己输入。
 *
 * @param baseline 当前基线。
 * @returns 建议的下一个基线。
 */
export function bumpBaseline(baseline: string): string {
  const match = /^(.*\.)(\d+)$/u.exec(baseline)
  if (match === null) return baseline
  const [, prefix, last] = match
  return `${prefix}${Number(last) + 1}`
}

export async function askCheckSelection(): Promise<CheckSelection[] | undefined> {
  const result = await multiselect({
    message: '选择检查任务（可多选）',
    required: true,
    options: [
      { value: 'sdd', label: 'SDD 文档', hint: '校验需求、计划、编号和内部链接' },
      { value: 'docs', label: '项目文档', hint: '构建 VitePress 文档站点' },
      { value: 'packages', label: '共享包', hint: '通过 Turbo 执行共享包检查' },
      { value: 'plugins', label: 'Harness 插件', hint: '通过 Turbo 执行插件检查' },
      { value: 'tooling', label: '构建工具', hint: '通过 Turbo 执行 tooling 检查' },
    ],
  })
  if (isCancel(result)) {
    cancel('已取消检查')
    return undefined
  }
  return result as CheckSelection[]
}

export async function askBuildSelection(): Promise<BuildSelection[] | undefined> {
  const result = await multiselect({
    message: '选择构建任务（可多选）',
    required: true,
    // 顺序按日常使用频率排：FPK 最常构建，Harness 插件放最后一行。
    options: [
      { value: 'fpk', label: 'fnOS FPK', hint: '可继续多选应用与目标平台，DSH 应用自动先构建网关' },
      { value: 'docs', label: '项目文档', hint: '构建 VitePress 文档站点' },
      { value: 'plugins', label: 'Harness 插件', hint: '通过 Turbo 构建插件及其共享包依赖' },
    ],
  })
  if (isCancel(result)) {
    cancel('已取消构建')
    return undefined
  }
  return result as BuildSelection[]
}

/**
 * 选择 FPK 的目标平台。
 *
 * 默认勾选各应用 `manifest` 自己声明的平台，也就是「不额外选择就得到与今天等价的
 * 那一份包」。清单没声明平台时**不预勾任何值**：猜一个默认值会让交互路径凭空产出一
 * 个包内没有依据的平台声明，而非交互路径同样情况是报错——两条路必须同判。
 *
 * 取消即取消本次 FPK 构建：平台是产物的必要属性，没有「一个平台都不出」这种中间态。
 */
export async function askFpkPlatforms(apps: FpkApp[]): Promise<FpkPlatform[] | undefined> {
  // 只把「合法且可构建」的声明值作为预勾项。`all` 是清单合法值但不是构建目标，
  // 预勾上一个不能构建的值只会让使用者选完再吃一次失败；那种情况由
  // resolveFpkPlatforms 在真正要产出时报错，指名字段而不是指选项。
  const declared = apps
    .map(app => app.platform)
    .filter((platform): platform is FpkPlatform => platform !== undefined && isFpkPlatform(platform))
  const result = await multiselect({
    message: '选择目标平台（可多选）',
    required: true,
    options: FPK_PLATFORMS.map(platform => ({
      value: platform,
      label: platform,
      ...(declared.includes(platform) ? { hint: 'manifest 声明的平台' } : {}),
    })),
    initialValues: declared,
  })
  if (isCancel(result)) {
    cancel('已取消 FPK 构建')
    return undefined
  }
  return parseFpkPlatforms(result as string[])
}

export async function askStartSelection(): Promise<StartSelection[] | undefined> {
  const result = await multiselect({
    message: '选择启动任务（可多选）',
    required: true,
    options: [
      { value: 'plugins', label: 'Harness 插件', hint: '通过 Turbo watch 编译插件及其共享包依赖' },
      { value: 'docs', label: '项目文档', hint: '启动 VitePress 文档开发服务' },
      { value: 'web', label: 'DSH Web', hint: '以仓库根 .dsh 作为 DSH_HOME 启动 DSH Web（端口 8070），与其他目标共用同一个 Turbo TUI' },
    ],
  })
  if (isCancel(result)) {
    cancel('已取消启动')
    return undefined
  }
  return result as StartSelection[]
}

export async function askPlugins(): Promise<string[] | undefined> {
  const result = await multiselect({
    message: '选择要编译的插件（可多选）',
    required: true,
    options: pluginTargets.map(target => ({ value: target.filter, label: target.label })),
  })
  if (isCancel(result)) {
    cancel('已取消插件构建')
    return undefined
  }
  return result as string[]
}

export async function askPublishPlugins(): Promise<PluginTarget[] | undefined> {
  const result = await multiselect({
    message: '选择要发布的 npm 插件（可多选）',
    required: true,
    options: pluginTargets.map(target => ({ value: target.value, label: target.label })),
  })
  if (isCancel(result)) {
    cancel('已取消 npm 发布')
    return undefined
  }
  const selected = new Set(result as string[])
  return pluginTargets.filter(target => selected.has(target.value))
}

export async function askFpkApps(apps: FpkApp[]): Promise<FpkApp[] | undefined> {
  if (apps.length === 1) return apps

  const result = await multiselect({
    message: '选择要编译的 FPK 应用（可多选）',
    required: true,
    options: apps.map(app => ({
      value: app.name,
      label: app.label,
      ...(app.requiresGateway ? { hint: '自动先编译 fnOS Gateway' } : {}),
    })),
  })
  if (isCancel(result)) {
    cancel('已取消 FPK 构建')
    return undefined
  }
  const selected = new Set(result as string[])
  return apps.filter(app => selected.has(app.name))
}

export async function askBundleDshPlugins(): Promise<boolean | undefined> {
  const result = await confirm({
    message: '是否将 Harness 清单插件内置到 FPK 包中？',
    initialValue: true,
  })
  if (isCancel(result)) {
    cancel('已取消 FPK 构建')
    return undefined
  }
  return result
}
