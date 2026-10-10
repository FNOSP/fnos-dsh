/** 共享的 DSH 插件 host 侧助手（本仓库内各插件单点复用）。 */
export {
  assessCredentialFile,
  assessCredentialMode,
  ownerUnreadableError,
  type CredentialFileFacts,
  type CredentialFileState,
} from './credential-permission.ts'
