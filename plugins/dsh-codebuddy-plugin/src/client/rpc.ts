import type { ConnectionRpc, RpcErr, RpcResult } from '../types/client/rpc'
export type { RpcOk, RpcErr, RpcResult, ConnectionRpc, AuthStatus, AccountView, AccountsResult, GrowthTaskView, GrowthTaskAccountView, GrowthTasksResult, GrowthRunItem, GrowthRunAccountResult, GrowthRunResult, GrowthRunLogEntryView, GrowthRunStateView, LoginStart, LoginPoll, UsageWindow, UsageResult } from '../types/client/rpc'

/** Turn an RPC failure into a readable string. */
export function describeRpcError(result: RpcErr): string {
  return `${result.error.code}: ${result.error.message}`
}

/**
 * 传输层失败（请求根本没拿到服务端信封）使用的 `error.code`。
 */
export const RPC_TRANSPORT_ERROR_CODE = 'transport'

/**
 * 把 RPC 面收敛成**永不拒绝**。
 *
 * `ConnectionRpc.call` 声明为 `Promise<RpcResult<T>>`——一个说明成功与否的结果
 * 信封。整个客户端就是按这个契约写的：每个调用点只判 `result.ok`，把「拒绝」
 * 当成不可能发生。但底层实现并不遵守它：它是 `async`，于是主机不可达、socket
 * 断开、非 2xx、`rpcId` 不匹配都会**拒绝**（见 `dsh-client-connection` 的
 * `async call`，传输失败时直接 `throw`）。只判 `result.ok` 的代码会径直走过
 * 这些情况。
 *
 * 后果不是理论上的，而且全都静默：
 *
 * - `await rpc.call(...)` 拒绝后，其后的语句被整段跳过——`setLoading(false)`、
 *   `setBusyId(undefined)`、重入标志复位都不执行，按钮永久转圈且不报错；
 * - 浮动的 `void rpc.call(...)` 变成未处理拒绝，浏览器只在没人看的控制台里报；
 * - `startLoginPolling` 的循环在第一跳就停摆，一次瞬时网络抖动就终结了本应
 *   轮询到自身截止时间的登录等待。
 *
 * 在这一处归一化——插件从 Cordis 上下文取 `rpc` 的唯一位置——可以一次修掉全部，
 * 而且这里正是正确的层次：该接缝本来就承诺返回结果信封，把传输拒绝转成
 * `{ ok: false }` 是**把声明好的契约补回来**，而不是要求约 30 个调用点各自设防。
 *
 * 已经自带 `.catch(...)` 的调用点继续可用；它们只是不再是「网络错误」与
 * 「永久转圈」之间唯一的那道防线。
 *
 * @param rpc - 来自 Connection 服务的原始 RPC 面。
 * @returns 等价的面，其 `call` 一定 resolve。
 */
export function guardRpc(rpc: ConnectionRpc): ConnectionRpc {
  return {
    call: async <T>(channel: string, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<RpcResult<T>> => {
      try {
        return await rpc.call<T>(channel, endpoint, payload, signal)
      } catch (error) {
        return {
          ok: false,
          error: {
            code: RPC_TRANSPORT_ERROR_CODE,
            message: error instanceof Error ? error.message : String(error),
            // 端点放进 `details`：让传输失败与服务端失败一样有定位信息。
            // `describeRpcError` 只渲染 `code: message`，光看 message 说不出
            // 是哪次调用挂了。
            details: { channel, endpoint },
          },
        }
      }
    },
  }
}
