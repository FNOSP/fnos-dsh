/**
 * 浏览器半侧使用的接入设置端点（FNOS-013-05、14 的设置页交互）。
 *
 * 为什么需要这条端点，而不是让浏览器直接写配置：
 *
 * 1. **密钥**：`apiKey` 是 `secret` 角色字段，明文不随配置读取面跨线（与
 *    `dsh-failover-search-plugin` 的账号 key 同一约束）。因此「显示当前密钥」只能由
 *    宿主按需送回，并且「重新随机生成」必须在宿主侧完成——在浏览器生成再写回会把
 *    明文密钥留在客户端往返与前端状态里。
 * 2. **反馈**：写配置走 `settings.update`，浏览器没有这条通道；生成密钥与改写家族
 *    都需要立即把**实际生效值**回给界面，否则界面显示与真实配置不一致。
 *
 * 端点挂在 DSH 的 Web 服务上（`ctx.webServer.register`），路径与其余插件同构：
 * `/plugins/<包名>/…`。变更类请求经 `trustedRequest` 校验（同源/本机对端），
 * 避免被第三方站点跨站触发。
 *
 * @module dsh-midscene/settings-routes
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
// Type-only：拉入 `webServer` 服务的 Context 合并（运行时不 import，客户端模块表
// 里没有这些包，运行时引入会报模块缺失）。
import type {} from '@deepseek-ai/dsh-host-webserver'
import {
  FIXED_MODEL_NAME,
  OPENAI_API_PREFIX,
  generateApiKey,
  renderEnvFile,
  volatileValue,
  BRIDGE_HOST,
  type BridgeConfig,
} from '../contracts/config.ts'
import { resolveFamily } from '../contracts/model-family.ts'
import { MIDSCENE_SETTINGS_NAMESPACE, MIDSCENE_SETTINGS_STATUS_PATH, MIDSCENE_SETTINGS_UPDATE_PATH } from '../contracts/settings-rpc.ts'

/** 设置界面可选的模型条目。 */
export interface SelectableModel {
  /** 「提供方/模型」标识。 */
  readonly id: string
  /** 可读名（有则展示）。 */
  readonly name?: string
  /** 是否具备图片输入能力（Midscene 需要）。 */
  readonly vision: boolean
}

/** 端点所需的宿主能力。 */
export interface SettingsRouteDeps {
  /** 读当前配置（volatile 解包后）。 */
  readonly readConfig: () => BridgeConfig
  /**
   * 读可选模型目录。
   *
   * 设置界面的「指定测试模型」改为下拉选择而不是手填：手填要求用户记住
   * 「提供方/模型」全称（如 `codebuddy/glm-5.3-flash`），写错只会在真正跑
   * Midscene 时才报错，且用户无从知道有哪些可用值。目录来自宿主模型层，
   * 与桥 /v1/models 同源。
   */
  readonly listModels: () => Promise<readonly SelectableModel[]>
  /**
   * 读「当前会实际使用的模型」标识。
   *
   * 用于**推导协议家族**：家族不是用户配置项，而是「按哪个模型对话就该用哪套坐标协议」
   * 的推论。取不到时（目录为空或未配置模型）返回 `undefined`，设置页据此提示无可用模型。
   */
  readonly resolveModel?: () => Promise<string | undefined>
  /** 写配置字段。 */
  readonly update: (patch: Record<string, unknown>) => Promise<void>
  /** 记录一行日志。 */
  readonly log: (message: string) => void
}

/** 判定请求是否来自可信来源（同源或本机对端）。 */
function trustedRequest(request: IncomingMessage): boolean {
  const header = (name: string): string | undefined => {
    const value = request.headers[name]
    return Array.isArray(value) ? value[0] : value
  }
  const fetchSite = header('sec-fetch-site')?.trim().toLowerCase()
  if (fetchSite === 'cross-site') return false
  const origin = header('origin')
  if (origin !== undefined) {
    const host = header('host')
    if (host === undefined) return false
    try {
      return new URL(origin).host === host
    } catch {
      return false
    }
  }
  const remote = request.socket.remoteAddress
  return remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1'
}

/** 发送 JSON 响应。 */
function sendJson(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'content-length': Buffer.byteLength(body),
  })
  response.end(body)
}

/** 读取 JSON 请求体（有大小上限，避免超大请求占用内存）。 */
function readJsonBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = ''
    let size = 0
    let done = false
    request.setEncoding('utf8')
    request.on('data', (chunk: string) => {
      if (done) return
      size += chunk.length
      if (size > 64 * 1024) {
        done = true
        reject(new Error('request body too large'))
        return
      }
      body += chunk
    })
    request.on('end', () => {
      if (done) return
      done = true
      if (body.trim() === '') {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(body))
      } catch {
        reject(new Error('invalid JSON body'))
      }
    })
    request.on('error', (error: Error) => {
      if (!done) {
        done = true
        reject(error)
      }
    })
  })
}

/**
 * 组装状态快照。
 *
 * 包含界面需要的全部事实：当前密钥、家族与可选值、指定模型、固定模型名与桥地址、
 * 以及一份可直接复制的 `.env` 文本。让界面只依赖这一个响应，避免多处读取产生不一致。
 * @param deps - 端点依赖。
 * @returns 状态快照。
 */
export async function statusSnapshotForTest(
  deps: Pick<SettingsRouteDeps, 'readConfig' | 'listModels' | 'resolveModel'>,
): Promise<Record<string, unknown>> {
  const config = deps.readConfig()
  const apiKey = config.apiKey.length > 0 ? config.apiKey : generateApiKey()
  // 目录读取失败不应让整个设置页打不开：退化为空列表，界面据此提示「无可用模型」。
  const available = await deps.listModels().catch(() => [] as readonly SelectableModel[])

  // 家族由**实际会使用的模型**推导，不是用户配置项（见 `resolveFamily`）。因此设置页
  // 只呈现「模型」这一件事，`.env` 里的家族随模型变化自动跟上。
  const chosen = deps.resolveModel === undefined ? undefined : await deps.resolveModel()
  const family = chosen === undefined
    ? { family: config.family, exact: false, reason: '尚未选择测试模型' }
    : resolveFamily(chosen)

  return {
    // 界面只需要「能识图的模型」：Midscene 靠截图理解页面，文本模型选进来也跑不了。
    availableModels: available
      .filter(model => model.vision === true)
      .map(model => ({
        id: model.id,
        vision: model.vision,
        ...model.name === undefined ? {} : { name: model.name },
      })),
    namespace: MIDSCENE_SETTINGS_NAMESPACE,
    apiKey,
    family: family.family,
    familyReason: family.reason,
    models: config.models,
    fixedModelName: FIXED_MODEL_NAME,
    baseUrl: `http://${BRIDGE_HOST}:${config.port}${OPENAI_API_PREFIX}`,
    envFile: renderEnvFile({ port: config.port, apiKey, family: family.family }),
  }
}

/**
 * 校验并归一化一次配置写入请求。
 *
 * 只接受**模型列表**：协议家族由桥按实际使用的模型自动推导（`resolveFamily`），不是用户
 * 配置项——把它暴露给用户既要求他们理解 Midscene 的内部协议，又必然产生「家族与模型不
 * 匹配」的静默错位。若请求里带了 `family`，这里直接忽略（老版本界面或脚本可能仍会发送），
 * 由桥在生成接入配置时按真实模型覆盖。
 * @param input - 写入请求体。
 * @returns 归一化后的补丁（只含出现过的字段）。
 */
export function normalizePatchForTest(input: Record<string, unknown>): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  if (Array.isArray(input.models)) {
    const models: string[] = []
    for (const value of input.models) {
      if (typeof value !== 'string') throw new Error('models must be an array of "provider/model" strings')
      const trimmed = value.trim()
      if (trimmed === '') continue
      models.push(trimmed)
    }
    patch.models = models
  }
  return patch
}

/**
 * 注册两个设置端点。
 *
 * - `GET  <status>`：读当前接入设置（含明文密钥与 `.env` 文本），供设置区块渲染。
 * - `POST <update>`：写家族/指定模型；`action: 'regenerate'` 重新随机生成密钥，
 *   `action: 'setKey'` 写入自定义密钥。
 *
 * @param ctx - 宿主插件上下文。
 * @param deps - 端点依赖。
 */
export function registerMidsceneSettingsRoutes(ctx: Context, deps: SettingsRouteDeps): void {
  ctx.effect(() => {
    const disposeStatus = ctx.webServer.register({
      kind: 'exact',
      path: MIDSCENE_SETTINGS_STATUS_PATH,
      handler: (request, response) => {
        void (async () => {
          if (request.method !== 'GET') {
            sendJson(response, 405, { error: 'method not allowed' })
            return
          }
          if (!trustedRequest(request)) {
            sendJson(response, 403, { error: 'untrusted origin' })
            return
          }
          try {
            sendJson(response, 200, await statusSnapshotForTest(deps))
          } catch (error) {
            deps.log(`[midscene] 读取接入设置失败: ${String(error)}`)
            sendJson(response, 500, { error: 'failed to read bridge settings' })
          }
        })()
      },
    })

    const disposeUpdate = ctx.webServer.register({
      kind: 'exact',
      path: MIDSCENE_SETTINGS_UPDATE_PATH,
      handler: (request, response) => {
        void (async () => {
          if (request.method !== 'POST') {
            sendJson(response, 405, { error: 'method not allowed' })
            return
          }
          if (!trustedRequest(request)) {
            sendJson(response, 403, { error: 'untrusted origin' })
            return
          }
          let body: Record<string, unknown>
          try {
            body = await readJsonBody(request) as Record<string, unknown>
          } catch (error) {
            sendJson(response, 400, { error: String((error as Error).message) })
            return
          }
          try {
            const action = typeof body.action === 'string' ? body.action : 'update'
            if (action === 'regenerate') {
              await deps.update({ apiKey: generateApiKey() })
            } else if (action === 'setKey') {
              const key = typeof body.apiKey === 'string' ? body.apiKey.trim() : ''
              if (key === '') {
                sendJson(response, 400, { error: 'apiKey must be a non-empty string' })
                return
              }
              await deps.update({ apiKey: key })
            } else {
              const patch = normalizePatchForTest(body)
              if (Object.keys(patch).length === 0) {
                sendJson(response, 400, { error: 'no supported field in request' })
                return
              }
              await deps.update(patch)
            }
            // 回送写入后的真实状态：界面据此校正，避免显示与配置不一致。
            sendJson(response, 200, await statusSnapshotForTest(deps))
          } catch (error) {
            deps.log(`[midscene] 写入接入设置失败: ${String(error)}`)
            sendJson(response, 400, { error: String((error as Error).message) })
          }
        })()
      },
    })

    return () => {
      disposeStatus()
      disposeUpdate()
    }
  }, 'dsh-midscene: settings routes')
}

export { volatileValue }
