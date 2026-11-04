import type { UsageLocaleKey } from './locales.ts'

/**
 * 日本語辞書（键集合与 zh 一致，由类型约束）。
 *
 * 键集合由 `UsageLocaleKey` 在编译期约束，缺键或多键都会 typecheck 失败。
 */
export const ja: { [Key in UsageLocaleKey]: string } = {
  // 区块标题
  sectionTitle: 'プラットフォームの使用量',
  refreshHint: '使用量はプラットフォームの無料照会エンドポイントから取得し、バックグラウンドで自動更新します',
  refresh: '更新',
  refreshing: '更新中',
  toggleOn: 'スマート検索',
  loading: '使用量のスナップショットを読み込んでいます…',
  unavailable: '使用量のスナップショットを利用できません',
  stale: 'スナップショットが古くなっています。検索自体は通常どおり実行されます',
  fetchedAt: '取得時刻',
  tinyfishTitle: 'TinyFish',
  tavilyTitle: 'Tavily',
  noAccount: 'アカウント未設定',
  balance: 'ウォレット残高',
  autoReload: '自動チャージ',
  searchRate: '検索単価',
  keyUsage: 'キーの使用量',
  plan: 'プラン',
  planUsage: 'プランの使用量',
  paygoUsage: '従量課金の使用量',

  // 官方配置表单的框架文案
  formUnavailable: '現在の DSH デプロイは、このページにこのプラグインの設定を提供していません。',
  formReadOnly: '現在のデプロイは設定を読み取り専用で保存するため、変更できません。',
  formSaveFailed: '保存が反映されませんでした。入力内容を確認して再試行してください。',
  formSave: '保存',
  formSaving: '保存しています…',
  formOverridden: '上書き済み',
  formReset: 'リセット',
  formInvalidNumber: '正の整数を入力してください',

  // 配置项
  accountsTitle: 'プラットフォームのアカウント',
  accountsHint: '各プラットフォームには複数のキーを設定できます。リクエストは同じプラットフォームのアカウント間で順に分散されます。キーは暗号化して保存され、画面に再表示されることはありません。',
  accountKey: 'API キー',
  accountKeyPlaceholder: 'プラットフォームの API キーを貼り付け',
  accountLabel: '表示名',
  accountLabelPlaceholderTinyfish: '例：tinyfish-1',
  accountLabelPlaceholderTavily: '例：tavily-1',
  accountLabelPlaceholder: '例：platform-1',
  accountAdd: 'アカウントを追加',
  accountRemove: '削除',
  accountCancel: 'キャンセル',
  accountConfirm: '追加',
  accountEmpty: 'アカウントが未設定のため、このプラットフォームは現在無効です。',
  accountKeepBlank: '空欄のままにすると、保存済みのキーを変更しません。',
  accountIndex: 'アカウント',
  accountKeySet: 'キー保存済み',
  accountEdit: '編集',
  accountCopy: 'キーをコピー',
  accountCopied: 'コピーしました',
  accountCopyFailed: 'コピーに失敗しました',
  accountSave: '保存',
  accountEditKeyPlaceholder: '空欄のままにすると、このキーを変更しません',
  accountEditHint: '空欄のままにすると元のキーを変更しません。表示名を空にすると表示名が削除されます。',

  orderTitle: '切り替えと分散',
  sourceOrder: 'ソースの順序',
  sourceOrderHint: 'ソースは順番に試されます。公式検索は常に最後のフォールバックとして参加します。',
  sourceOrderOfficial: '公式検索',
  timeoutMs: 'ソースごとのタイムアウト（ミリ秒）',
  timeoutMsHint: 'アカウントごとの 1 回の検索リクエストのタイムアウトです。ツール全体の予算より小さくしてください。',
  samePlatformRetry: '同一プラットフォーム内での再試行',
  samePlatformRetryHint: 'あるアカウントが失敗したあと、同じプラットフォームの別アカウントも試すかどうか。',

  usageTitle: '使用量の表示と事前確認',
  usageRefreshMinutes: '使用量の更新間隔（分）',
  usageRefreshMinutesHint: '使用量スナップショットをバックグラウンドで更新する周期です。1〜60 の範囲で指定します。',
  requestProbe: 'リクエスト前の確認',
  requestProbeHint: '使用量スナップショットに基づき、クォータが不足しているアカウントを事前にスキップします。',
  on: 'オン',
  off: 'オフ',
}
