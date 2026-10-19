import { cancel, confirm, isCancel, multiselect, select, text } from '@clack/prompts'
import { pluginTargets, type PluginTarget } from '../config/targets.js'
import type { FpkApp } from '../config/workspace.js'

/**
 * 发布类型：普通递增，或切换到新的 DSH 基线。
 *
 * 两者产出完全不同的版本号（`…rc.2.5 → …rc.2.6` 对 `…rc.2.5 → …rc.5.0`），
 * 所以必须在发布前明确选，而不是靠记住某个 flag。
 */
export type VersionReleaseKind = 'patch' | 'baseline'

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
 * 询问本次发布的类型。
 *
 * @param currentBaseline 当前 catalog 中的 DSH 基线，用于在选项里直接显示。
 * @returns 发布类型；取消时返回 `undefined`。
 */
export async function askVersionReleaseKind(currentBaseline: string): Promise<VersionReleaseKind | undefined> {
  const result = await select({
    message: '选择本次发布类型',
    initialValue: 'patch',
    options: [
      {
        value: 'patch',
        label: '迭代号 +1',
        hint: `DSH 基线不变（${currentBaseline}），项目与插件一起 +1`,
      },
      {
        value: 'baseline',
        label: '切换 DSH 基线',
        hint: 'DSH 发了新版本：改 catalog 并把迭代号重置为 0',
      },
    ],
  })
  if (isCancel(result)) {
    cancel('已取消版本维护')
    return undefined
  }
  return result as VersionReleaseKind
}

/**
 * 询问新的 DSH 基线版本号。
 *
 * 会校验形态并提示「与当前相同则不会被视为基线变化」，避免输入错值后误以为是
 * 一次基线切换。
 *
 * @param currentBaseline 当前基线，作为默认值与对照。
 * @returns 新基线版本号；取消时返回 `undefined`。
 */
export async function askTargetBaseline(currentBaseline: string): Promise<string | undefined> {
  const result = await text({
    message: `输入新的 DSH 基线（当前 ${currentBaseline}）`,
    placeholder: '0.2.1-rc.5',
    validate: value => {
      const trimmed = value?.trim() ?? ''
      if (trimmed === '') return '请输入基线版本号'
      if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u.test(trimmed)) {
        return '基线形态应为 MAJOR.MINOR.PATCH，可带预发布段（如 0.2.1-rc.5）'
      }
      if (trimmed === currentBaseline) return `与当前基线相同，不会被视为基线变化；本次请改用「迭代号 +1」`
      return undefined
    },
  })
  if (isCancel(result)) {
    cancel('已取消版本维护')
    return undefined
  }
  return String(result).trim()
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
    options: [
      { value: 'plugins', label: 'Harness 插件', hint: '通过 Turbo 构建插件及其共享包依赖' },
      { value: 'fpk', label: 'fnOS FPK', hint: '可继续多选应用，DSH 应用自动先构建网关' },
      { value: 'docs', label: '项目文档', hint: '构建 VitePress 文档站点' },
    ],
  })
  if (isCancel(result)) {
    cancel('已取消构建')
    return undefined
  }
  return result as BuildSelection[]
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
