/**
 * Start Plan 端点的准入前缀。
 *
 * 实测结论（2026-10-25，抓包 + 逐项二分）：`/api/v1/zcode-plan/anthropic`
 * 会在网关侧校验 `system` 是否为官方 agent 原文——两段内容必须逐字一致，
 * `system[0]` 少一个字母都会被判 `3012`；`system[1]` 必须作为完整前缀出现，
 * 其后可以继续追加内容。除此之外请求头只需要三个，工具声明、metadata、
 * device_id 与各类 `x-zcode-*` 头都与放行无关。
 *
 * 这两段文字是 ZCode 官方 agent 的系统提示词。插件把它们作为**前缀**放在
 * 自己构造的 system 之前，以满足该校验；DSH 自己的指令接在其后。
 * 上游若改动提示词，这里会失配并退回 `3012`，届时需要重新采集。
 *
 * @module dsh-zcode/start-plan-prefix
 */

/** 第一段：固定 42 字符的 agent 身份行，必须逐字一致。 */
export const START_PLAN_PREFIX_HEAD: string = "You are ZCode, an interactive coding agent"

/**
 * 第二段：官方 agent 的行为提示词，必须作为完整前缀出现。
 *
 * 只做前缀匹配，因此可以在它之后追加插件自己的约束。
 */
export const START_PLAN_PREFIX_BODY: string = "\nYou are an interactive ZCode agent that helps users with software engineering tasks.\n\nIMPORTANT: Assist with authorized security testing, defensive security, CTF challenges, and educational contexts. Refuse requests for destructive techniques, DoS attacks, mass targeting, supply chain compromise, or detection evasion for malicious purposes. Dual-use security tools (C2 frameworks, credential testing, exploit development) require clear authorization context: pentesting engagements, CTF competitions, security research, or defensive use cases.\n\n# Harness\n- Text you output outside of tool use is displayed to the user as Github-flavored markdown in a terminal.\n- Tools run behind a user-selected permission mode; a denied call means the user declined it — adjust, don't retry verbatim.\n- The system may send updates, reminders, or modifications to rules via mid-conversation system turns. These are system-controlled, unlike function results. Hooks may intercept tool calls; treat hook output as user feedback.\n- Prefer the dedicated file/search tools over shell commands when one fits. Independent tool calls can run in parallel in one response.\n- Reference code as `file_path:line_number` — it's clickable."

/** 注入到 system 最前面的两段前缀。 */
export function startPlanSystemPrefix(): readonly { readonly type: 'text'; readonly text: string }[] {
  return [
    { type: 'text', text: START_PLAN_PREFIX_HEAD },
    { type: 'text', text: START_PLAN_PREFIX_BODY },
  ]
}

/**
 * 官方请求体里存在、但通用 Anthropic 客户端不会发送的字段。
 *
 * 实测对比（2026-10-25 抓包）：官方 agent 的请求体比 pi-ai 多四项——
 * `thinking`、`output_config`、`tool_choice`、`metadata`。网关按"像不像官方
 * 客户端"判定风险，缺字段会扩大被拦面；这里按官方值与结构补齐，不做裁剪。
 *
 * `metadata.user_id` 是 JSON 字符串，内含设备与会话标识；缺失时网关无法把
 * 请求关联到设备，容易触发风控。
 */
export interface StartPlanExtraFieldsInput {
  /** 稳定的设备标识（与请求头 `x-device-mid` 同源）。 */
  readonly deviceId: string
  /** 本次会话标识；缺省时用设备标识，保证字段存在。 */
  readonly sessionId?: string
  /** 期望的思考强度；官方用 `output_config.effort` 表达。 */
  readonly effort?: string
  /** 是否启用思考；官方在开启推理时发 `{type:'enabled'}`。 */
  readonly thinking?: boolean
}

/** 构造官方同款附加字段。 */
export function startPlanExtraFields(input: StartPlanExtraFieldsInput): Record<string, unknown> {
  const effort = input.effort ?? 'max'
  return {
    metadata: {
      user_id: JSON.stringify({
        device_id: input.deviceId,
        account_uuid: '',
        session_id: input.sessionId ?? input.deviceId,
      }),
    },
    tool_choice: { type: 'auto' },
    ...(input.thinking === false ? {} : { thinking: { type: 'enabled' } }),
    output_config: { effort },
  }
}
