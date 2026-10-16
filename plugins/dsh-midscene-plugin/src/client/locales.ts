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
  apiKeyHint: '桥接服务的接入密钥，不是模型密钥。重新生成后需要同步更新下面的接入配置（命令行 .env 与浏览器扩展两处）。',
  regenerate: '随机重新生成',
  regenerating: '生成中…',
  customKey: '自定义密钥',
  customKeyPlaceholder: '输入自定义密钥',
  save: '保存',
  saving: '保存中…',
  cancel: '取消',
  copy: '复制',
  copied: '已复制',
  modelsLabel: '指定测试模型',
  modelsHint: '只列出具备识图能力的模型（Midscene 靠截图理解页面）。留空则跟随 DSH 当前会话模型；会话模型不具备识图能力时，插件会自动改用可用的识图模型。Midscene 的协议家族由插件按实际使用的模型自动匹配，无需设置。',
  modelsPlaceholder: '选择用于 Midscene 的识图模型',
  modelsEmpty: '未指定，跟随 DSH 会话模型',
  modelsSearch: '搜索模型',
  modelsNoneSelected: '未指定（跟随 DSH 会话模型）',
  modelsStale: '目录中已不存在',
  modelsUnavailable: 'DSH 当前没有可用于 Midscene 的识图模型。请先在 DSH 中安装并登录一个提供方（模型需具备图片输入能力），然后回到本页重新加载。',
  addModel: '添加模型',
  removeModel: '移除',
  envLabel: '接入配置（命令行 .env 或 Midscene 浏览器扩展）',
  envHint: '两条路都用这四行：跑命令行时保存为工作目录的 .env；用 Chrome 里的 Midscene 扩展时，打开它的侧边栏设置把这段粘进去。模型跟随当前 DSH 会话，不需要任何第三方模型密钥。',
  envCopy: '复制接入配置',
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
  apiKeyHint: 'Access key for the bridge, not a model key. Regenerating requires updating the access config below (both the CLI .env and the browser extension).',
  regenerate: 'Regenerate',
  regenerating: 'Generating…',
  customKey: 'Custom key',
  customKeyPlaceholder: 'Enter a custom key',
  save: 'Save',
  saving: 'Saving…',
  cancel: 'Cancel',
  copy: 'Copy',
  copied: 'Copied',
  modelsLabel: 'Test models',
  modelsHint: 'Only vision-capable models are listed (Midscene reads the page from screenshots). Empty follows the current DSH session model; if that model cannot take images, the plugin switches to one that can. Midscene\'s protocol family is matched automatically from the model actually used.',
  modelsPlaceholder: 'Choose vision-capable models for Midscene',
  modelsEmpty: 'Not pinned — follows the DSH session model',
  modelsSearch: 'Search models',
  modelsNoneSelected: 'Not pinned (follows the DSH session model)',
  modelsStale: 'Not in catalog',
  modelsUnavailable: 'DSH has no vision-capable model available for Midscene. Install and sign in to a provider in DSH first (the model needs image input), then reload this page.',
  addModel: 'Add model',
  removeModel: 'Remove',
  envLabel: 'Access config (CLI .env or Midscene browser extension)',
  envHint: 'Both paths use these four lines: save them as .env in the directory where you run the CLI, or open the Midscene browser extension sidebar settings and paste them there. The model follows the current DSH session — no third-party model key is needed.',
  envCopy: 'Copy access config',
  loading: 'Reading current settings…',
  loadFailed: 'Failed to read settings',
  saveFailed: 'Failed to save',
  reload: 'Retry',
}

/** 文案键。 */
export type MidsceneLocaleKey = keyof typeof zh
