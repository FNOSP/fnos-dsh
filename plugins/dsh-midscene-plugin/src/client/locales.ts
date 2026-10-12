/**
 * 设置区块的文案（简体中文与英文）。
 *
 * 与其余插件同构：文案集中在 `client/locales.ts`，通过 `ctx.locale.register` 注册到
 * 命名空间，组件只接收一个 `t` 函数。
 *
 * @module dsh-midscene/client/locales
 */

/** 简体中文文案。 */
export const zh = {
  sectionTitle: 'Midscene 接入设置',
  sectionHint: 'Midscene 通过本地桥接服务使用 DSH 已配置的模型，无需任何模型 API 密钥。',
  apiKeyLabel: '接入密钥',
  apiKeyHint: '桥接服务的接入密钥，不是模型密钥。重新生成后需要同步更新 Midscene 的 .env。',
  regenerate: '随机重新生成',
  regenerating: '生成中…',
  customKey: '自定义密钥',
  customKeyPlaceholder: '输入自定义密钥',
  save: '保存',
  saving: '保存中…',
  cancel: '取消',
  copy: '复制',
  copied: '已复制',
  familyLabel: 'Midscene 协议家族',
  familyHint: '决定 Midscene 的提示词模板与坐标解析协议，必须与所选模型的系列匹配。',
  familyInvalid: '该取值不在 Midscene 接受的家族列表内',
  modelsLabel: '指定测试模型',
  modelsHint: '留空则跟随 DSH 当前会话模型。多个模型按顺序尝试第一个可用的。',
  modelsPlaceholder: '提供方/模型，例如 codebuddy/glm-5.3-flash',
  modelsEmpty: '未指定，跟随 DSH 会话模型',
  addModel: '添加模型',
  removeModel: '移除',
  envLabel: 'Midscene .env',
  envHint: '在运行 Midscene 的工作目录保存为 .env 即可；换模型不需要修改这里。',
  envCopy: '复制 .env 内容',
  loading: '正在读取当前设置…',
  loadFailed: '读取设置失败',
  saveFailed: '保存失败',
  reload: '重试',
}

/** 英文文案。 */
export const en = {
  sectionTitle: 'Midscene bridge settings',
  sectionHint: 'Midscene drives DSH-configured models through the local bridge — no model API key needed.',
  apiKeyLabel: 'Bridge access key',
  apiKeyHint: 'Access key for the bridge, not a model key. Regenerating requires updating the Midscene .env.',
  regenerate: 'Regenerate',
  regenerating: 'Generating…',
  customKey: 'Custom key',
  customKeyPlaceholder: 'Enter a custom key',
  save: 'Save',
  saving: 'Saving…',
  cancel: 'Cancel',
  copy: 'Copy',
  copied: 'Copied',
  familyLabel: 'Midscene protocol family',
  familyHint: 'Selects Midscene prompt templates and coordinate parsing; must match the chosen model family.',
  familyInvalid: 'This value is not an accepted Midscene family',
  modelsLabel: 'Pinned test models',
  modelsHint: 'Empty follows the current DSH session model. Multiple entries try in order until one exists.',
  modelsPlaceholder: 'provider/model, e.g. codebuddy/glm-5.3-flash',
  modelsEmpty: 'Not pinned — follows the DSH session model',
  addModel: 'Add model',
  removeModel: 'Remove',
  envLabel: 'Midscene .env',
  envHint: 'Save as .env in the directory where you run Midscene; changing models does not require editing it.',
  envCopy: 'Copy .env contents',
  loading: 'Reading current settings…',
  loadFailed: 'Failed to read settings',
  saveFailed: 'Failed to save',
  reload: 'Retry',
}

/** 文案键。 */
export type MidsceneLocaleKey = keyof typeof zh
