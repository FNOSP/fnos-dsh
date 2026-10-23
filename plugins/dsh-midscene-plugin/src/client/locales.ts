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
  modelsLabel: '各职责使用的模型',
  modelsHint: 'Midscene 按四种职责取用模型：默认职责提供全部能力，其余三个可选职责留空时沿用默认。只列出具备识图能力的模型（Midscene 靠截图理解页面）。通常只配默认就够了——定位不稳或长流程分支多时，再给对应职责单独配一个。',
  modelsPlaceholder: '选择用于 Midscene 的识图模型',
  modelsEmpty: '未指定，跟随 DSH 会话模型',
  modelsSearch: '搜索模型',
  modelsNoneSelected: '未指定（跟随 DSH 会话模型）',
  intentInheritPlaceholder: '未指定（沿用默认职责）',
  intentDefault: '默认',
  intentLocate: '定位',
  intentPlanning: '规划',
  intentInsight: '页面理解',
  intentResolved: '当前实际使用',
  intentNoModel: '没有可用的识图模型',
  intentInherited: '沿用默认',
  modelsStale: '目录中已不存在',
  modelsUnavailable: 'DSH 当前没有可用于 Midscene 的识图模型。请先在 DSH 中安装并登录一个提供方（模型需具备图片输入能力），然后回到本页重新加载。',
  addModel: '添加模型',
  removeModel: '移除',
  envLabel: '接入配置（命令行 .env 或 Midscene 浏览器扩展）',
  envHint: '常规只需用在这里：跑命令行时保存为工作目录的 .env。桥接模式下推理在跑脚本这一侧完成，Chrome 里的 Midscene 扩展不必配模型——只有用扩展自带的 Playground 时，才需要把这段粘进它的侧边栏设置。默认只有四行；给专用职责配了模型后会自动追加对应变量组。不需要任何第三方模型密钥。',
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
  modelsLabel: 'Models by role',
  modelsHint: 'Midscene uses models by role: the default model provides every capability, and the three optional roles fall back to it when left empty. Only vision-capable models are listed (Midscene reads the page from screenshots). Configuring just the default is usually enough — add a dedicated model for a role when localization is unstable or planning has many branches.',
  modelsPlaceholder: 'Choose vision-capable models for Midscene',
  modelsEmpty: 'Not pinned — follows the DSH session model',
  modelsSearch: 'Search models',
  modelsNoneSelected: 'Not pinned (follows the DSH session model)',
  intentInheritPlaceholder: 'Not pinned (uses the default role)',
  intentDefault: 'Default',
  intentLocate: 'Locate',
  intentPlanning: 'Planning',
  intentInsight: 'Insight',
  intentResolved: 'Currently using',
  intentNoModel: 'no vision-capable model available',
  intentInherited: 'inherits the default',
  modelsStale: 'Not in catalog',
  modelsUnavailable: 'DSH has no vision-capable model available for Midscene. Install and sign in to a provider in DSH first (the model needs image input), then reload this page.',
  addModel: 'Add model',
  removeModel: 'Remove',
  envLabel: 'Access config (CLI .env or Midscene browser extension)',
  envHint: 'Both paths use the same text: save it as .env in the directory where you run the CLI, or open the Midscene browser extension sidebar settings and paste it there. It is four lines by default; configuring a dedicated role appends that role\'s variable group. No third-party model key is needed.',
  envCopy: 'Copy access config',
  loading: 'Reading current settings…',
  loadFailed: 'Failed to read settings',
  saveFailed: 'Failed to save',
  reload: 'Retry',
}

/** 文案键。 */
export type MidsceneLocaleKey = keyof typeof zh
