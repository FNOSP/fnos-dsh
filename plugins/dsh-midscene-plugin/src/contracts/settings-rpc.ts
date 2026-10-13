/**
 * 接入设置端点的路径与响应形状（宿主与浏览器半侧共用）。
 *
 * 放在 `contracts/` 而不是任一侧：两侧必须对路径与字段名达成一致，而浏览器半侧
 * 不能 import 宿主模块（会拖入 schemastery、node:crypto 等宿主依赖）。本文件只含
 * 常量与类型，两侧都可安全引用。
 *
 * @module dsh-midscene/settings-rpc
 */

/** 包名（客户端模块图与详情页 subject 判定都按它匹配）。 */
export const MIDSCENE_PACKAGE_NAME = '@tnnevol/dsh-midscene'

/**
 * 设置命名空间：即插件在 profile 里的入口 id。
 *
 * DSH 通过 `entry.fiber.runtime.Config` 解析命名空间，因此这个值必须与
 * `cordis.patch.yml` 里那一行的 `id` 一致；否则 `settings.update` 会失败并报
 * `No configurable plugin entry`。
 */
export const MIDSCENE_SETTINGS_NAMESPACE = 'dsh-midscene'

/** 读取当前接入设置的端点。 */
export const MIDSCENE_SETTINGS_STATUS_PATH = '/plugins/dsh-midscene-plugin/settings'

/** 写入接入设置的端点。 */
export const MIDSCENE_SETTINGS_UPDATE_PATH = '/plugins/dsh-midscene-plugin/settings/update'

/** 设置区块渲染所需的全部事实。 */
export interface MidsceneSettingsSnapshot {
  /** 设置命名空间。 */
  readonly namespace: string
  /** 当前接入密钥（明文；桥的密钥，非模型凭据）。 */
  readonly apiKey: string
  /**
   * 当前生效的协议家族。
   *
   * **不是用户配置项**：由桥按实际使用的模型推导（`resolveFamily`）。设置页不显示它，
   * 只在需要说明「正在用什么协议」时引用——用户不需要理解这个内部细节。
   */
  readonly family: string
  /** 家族判定依据（供诊断说明，不要求用户理解）。 */
  readonly familyReason: string
  /** 指定用于测试的模型列表；空表示跟随 DSH 会话模型。 */
  readonly models: readonly string[]
  /**
   * 可供选择的模型目录（设置界面下拉选项）。
   *
   * 界面用下拉而非手填：手填要求用户记住「提供方/模型」全称，写错只会在真正
   * 跑 Midscene 时才暴露，且用户无从知道有哪些可用值。
   */
  /**
   * 可选模型：**只含具备识图能力的模型**（Midscene 靠截图理解页面）。
   *
   * 协议家族与模型的关系由桥在内部处理，因此这里不带家族信息——界面不呈现这个概念。
   */
  readonly availableModels: readonly {
    readonly id: string
    readonly name?: string
    readonly vision: boolean
  }[]
  /** 固定模型名（`MIDSCENE_MODEL_NAME` 的值）。 */
  readonly fixedModelName: string
  /** 桥地址（`.env` 里 `MIDSCENE_MODEL_BASE_URL` 的值）。 */
  readonly baseUrl: string
  /** 可直接写入 `.env` 的完整文本。 */
  readonly envFile: string
}

/** 写入请求：`update` 提交字段，`regenerate` 重随机密钥，`setKey` 写自定义密钥。 */
export type MidsceneSettingsRequest =
  | { readonly action: 'regenerate' }
  | { readonly action: 'setKey', readonly apiKey: string }
  | {
    readonly action: 'update'
    /**
     * 模型列表。
     *
     * 协议家族不在此列：它由桥按实际使用的模型推导，不是用户配置项。请求里若带了
     * `family` 会被忽略（旧版界面或脚本可能仍会发送）。
     */
    readonly models?: readonly string[]
  }
