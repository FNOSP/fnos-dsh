import type { MidsceneLocaleKey } from './locales.ts'

/**
 * 日本語辞書（键集合与 zh 一致，由类型约束）。
 *
 * 键集合由 `MidsceneLocaleKey` 在编译期约束，缺键或多键都会 typecheck 失败。
 */
export const ja: { [Key in MidsceneLocaleKey]: string } = {
  sectionTitle: 'Midscene 連携設定',
  sectionHint: 'Midscene はローカルブリッジサービスを通じて DSH に設定済みのモデルを利用します。モデル API キーは不要です。',
  apiKeyLabel: '接続キー',
  apiKeyHint: 'ブリッジサービスの接続キーで、モデルのキーではありません。再生成したら、下の接続設定（コマンドラインの .env とブラウザ拡張の 2 か所）も合わせて更新してください。',
  regenerate: 'ランダムに再生成',
  regenerating: '生成しています…',
  customKey: 'カスタムキー',
  customKeyPlaceholder: 'カスタムキーを入力',
  save: '保存',
  saving: '保存しています…',
  cancel: 'キャンセル',
  copy: 'コピー',
  copied: 'コピーしました',
  modelsLabel: '役割ごとに使うモデル',
  modelsHint: 'Midscene は 4 つの役割でモデルを使い分けます。既定の役割がすべての機能を担い、残り 3 つの任意の役割は空の場合に既定を使用します。画像を理解できるモデルのみが表示されます（Midscene はスクリーンショットからページを理解します）。通常は既定の設定だけで十分です。要素の特定が不安定な場合や、分岐の多い長い処理を扱う場合に、該当する役割へ個別にモデルを設定してください。',
  modelsPlaceholder: 'Midscene で使う画像対応モデルを選択',
  modelsEmpty: '未指定（DSH セッションのモデルに従います）',
  modelsSearch: 'モデルを検索',
  modelsNoneSelected: '未指定（DSH セッションのモデルに従います）',
  intentInheritPlaceholder: '未指定（既定の役割を使用）',
  intentDefault: '既定',
  intentLocate: '位置特定',
  intentPlanning: '計画',
  intentInsight: 'ページ理解',
  intentResolved: '現在使用中',
  intentNoModel: '利用できる画像対応モデルがありません',
  intentInherited: '既定を使用',
  modelsStale: 'カタログに存在しません',
  modelsUnavailable: 'DSH に Midscene で使える画像対応モデルがありません。先に DSH でプロバイダーをインストールしてログインし（モデルは画像入力に対応している必要があります）、このページに戻って再読み込みしてください。',
  addModel: 'モデルを追加',
  removeModel: '削除',
  envLabel: '接続設定（コマンドラインの .env または Midscene ブラウザ拡張）',
  envHint: '通常はここで取得した内容を使います。コマンドラインで実行する場合は、作業ディレクトリに .env として保存してください。ブリッジモードでは推論はスクリプトを実行する側で行われるため、Chrome の Midscene 拡張にモデルを設定する必要はありません。拡張機能の Playground を使う場合に限り、この内容をサイドバーの設定に貼り付けてください。既定では 4 行で、専用の役割にモデルを設定すると対応する変数グループが自動で追加されます。サードパーティのモデルキーは不要です。',
  envCopy: '接続設定をコピー',
  loading: '現在の設定を読み込んでいます…',
  loadFailed: '設定を読み込めませんでした',
  saveFailed: '保存に失敗しました',
  reload: '再試行',
}
