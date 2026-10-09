/**
 * 接缝错误分类的读写工具。
 *
 * `WebError` 的构造签名是 `(message, code)`：码是**独立参数**，不是消息前缀。
 * 工具层把码放进结构化错误元数据，模型侧与展示层都按码分支，因此接缝错误必须
 * 始终带码构造——把码拼进消息会让调用方只能靠解析文本判断类别。
 */
import { WebError } from '@deepseek-ai/dsh-web'

/** `dsh-web` 声明的共享错误码（见 `@deepseek-ai/dsh-web/types` 的 `WebError` 文档）。 */
export const WEB_ABORTED = 'WEB_ABORTED'
export const WEB_PROVIDER_ERROR = 'WEB_PROVIDER_ERROR'
export const WEB_PROVIDER_CREDENTIAL_MISSING = 'WEB_PROVIDER_CREDENTIAL_MISSING'

/** 读取一个错误的接缝错误码；不是接缝错误时返回 undefined。 */
export function errorCode(error: unknown): string | undefined {
  if (error instanceof WebError) return error.code
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code
    return typeof code === 'string' ? code : undefined
  }
  return undefined
}

/** 判断一个错误是否代表用户中止（中止不触发转移）。 */
export function isAborted(error: unknown): boolean {
  const code = errorCode(error)
  if (code === WEB_ABORTED) return true
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')
}

/** 把任意失败折成带码的接缝错误；已带接缝码的错误原样传递。 */
export function toWebError(error: unknown, fallbackMessage: string): WebError {
  if (error instanceof WebError) return error
  const code = errorCode(error) ?? WEB_PROVIDER_ERROR
  const message = error instanceof Error && error.message.length > 0 ? error.message : fallbackMessage
  return new WebError(message, code)
}
