#!/usr/bin/env node
/**
 * fnos-dsh 社区值班助手。
 *
 * 硬性约束（脚本层面强制，不依赖执行者自觉）：
 * - 只读 issues / PRs / discussions，只写「评论」这一个写接口；不 push、不 merge、不改 label、不改 issue 状态。
 * - 绝不把本地文件内容发到 GitHub：正文只能来自临时 outbox 文件，且发布前逐行比对本地文件内容，命中即拒绝。
 * - 网络抖动（连接重置、超时、5xx）自动重试 3~5 次；触发限流时读取 rate_limit 剩余额度并中止。
 *
 * 子命令：
 * - scan          列出本轮待处理的新增/待跟进事项（JSON 输出）
 * - reply         发布自动回复（自动追加 <!-- dsh-bot:v1 --> 签名）
 * - mark          登记处理结果（replied / manual / ignored），供下一轮去重
 * - state         打印本地状态摘要
 * - rate-limit    打印 API 剩余额度
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const REPO = process.env.DUTY_REPO ?? 'FNOSP/fnos-dsh'
const SIGNATURE = '<!-- dsh-bot:v1 -->'
const WORKSPACE = resolve(process.env.DUTY_WORKSPACE ?? process.cwd())
const STATE_DIR = resolve(process.env.DUTY_STATE_DIR ?? join(WORKSPACE, 'tmp', 'community-duty'))
const STATE_FILE = join(STATE_DIR, 'state.json')
const OUTBOX_DIR = join(STATE_DIR, 'outbox')
const MAX_ATTEMPTS = Math.max(3, Math.min(5, Number(process.env.DUTY_MAX_ATTEMPTS ?? 5)))
const API_BASE = (process.env.DUTY_API_BASE ?? 'https://api.github.com').replace(/\/$/, '')
const BACKOFF_MS = [1000, 3000, 9000, 27000]

/** 归一化本地文件行时的最小长度：短于此长度的行不参与「本地内容」比对，避免误伤命令示例。 */
const LOCAL_LINE_MIN_LEN = 40
/** 单行超过该长度且与本地文件逐字相同，直接判定为本地文件内容。 */
const LOCAL_LINE_HARD_LEN = 80
/** 单文件超过该大小不参与比对（构建产物/二进制）。 */
const LOCAL_FILE_MAX_BYTES = 512 * 1024

class RateLimitError extends Error {
  constructor(message) {
    super(message)
    this.name = 'RateLimitError'
  }
}

class GuardError extends Error {
  constructor(message) {
    super(message)
    this.name = 'GuardError'
  }
}

function fail(message, code = 1) {
  process.stderr.write(`${message}\n`)
  process.exit(code)
}

function sleep(ms) {
  return new Promise(resolveSleep => setTimeout(resolveSleep, ms))
}

function parseArgs(argv) {
  const args = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith('--')) {
      args._.push(arg)
      continue
    }
    const [rawKey, inlineValue] = arg.slice(2).split('=')
    const key = rawKey.replace(/-([a-z])/g, (_, char) => char.toUpperCase())
    if (inlineValue !== undefined) {
      args[key] = inlineValue
    } else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) {
      args[key] = argv[++i]
    } else {
      args[key] = true
    }
  }
  return args
}

let cachedToken

function resolveToken() {
  if (cachedToken !== undefined) return cachedToken
  for (const name of ['DUTY_GITHUB_TOKEN', 'GITHUB_TOKEN', 'GH_TOKEN']) {
    const value = process.env[name]
    if (value && value.trim()) {
      cachedToken = value.trim()
      return cachedToken
    }
  }
  try {
    const output = execFileSync('gh', ['auth', 'token'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    cachedToken = output || null
  } catch {
    cachedToken = null
  }
  return cachedToken
}

const rateLimit = { limit: null, remaining: null, reset: null, authenticated: false }

function updateRateLimit(res) {
  const remaining = res.headers.get('x-ratelimit-remaining')
  const limit = res.headers.get('x-ratelimit-limit')
  const reset = res.headers.get('x-ratelimit-reset')
  if (remaining !== null) rateLimit.remaining = Number(remaining)
  if (limit !== null) rateLimit.limit = Number(limit)
  if (reset !== null) rateLimit.reset = Number(reset) * 1000
}

/**
 * 统一的请求重试层：网络抖动（连接重置、超时）与 5xx 自动重试，限流直接中止并报出剩余额度。
 */
async function requestWithRetry(method, url, { headers, body }) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res
    try {
      res = await fetch(url, { method, headers, body })
    } catch (error) {
      if (attempt === MAX_ATTEMPTS) {
        throw new Error(`GitHub API ${method} ${url} 网络失败（已重试 ${MAX_ATTEMPTS - 1} 次）：${error.message}`)
      }
      await sleep(BACKOFF_MS[Math.min(attempt - 1, BACKOFF_MS.length - 1)])
      continue
    }

    updateRateLimit(res)
    if (res.ok) return res

    if (res.status === 403 || res.status === 429) {
      const remaining = Number(res.headers.get('x-ratelimit-remaining') ?? '1')
      if (remaining === 0) {
        const resetText = rateLimit.reset ? new Date(rateLimit.reset).toISOString() : '未知'
        throw new RateLimitError(`GitHub API 限流：额度已用尽（${rateLimit.limit ?? '?'}/h），重置时间 ${resetText}`)
      }
      const retryAfter = Number(res.headers.get('retry-after') ?? '0')
      if (attempt < MAX_ATTEMPTS) {
        await sleep(retryAfter > 0 ? retryAfter * 1000 : BACKOFF_MS[Math.min(attempt - 1, BACKOFF_MS.length - 1)])
        continue
      }
    } else if (res.status >= 500 && attempt < MAX_ATTEMPTS) {
      await sleep(BACKOFF_MS[Math.min(attempt - 1, BACKOFF_MS.length - 1)])
      continue
    }
    const text = await res.text()
    throw new Error(`GitHub API ${method} ${url} → ${res.status}：${text.slice(0, 300)}`)
  }
  throw new Error(`GitHub API ${method} ${url} 失败`)
}

function authHeaders(extra = {}) {
  const headers = {
    'accept': 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'fnos-dsh-community-duty',
    ...extra,
  }
  const token = resolveToken()
  if (token) {
    headers.authorization = `Bearer ${token}`
    rateLimit.authenticated = true
  } else {
    rateLimit.authenticated = false
  }
  return headers
}

/**
 * 调用 GitHub REST API。
 */
async function api(method, path, { body } = {}) {
  const headers = authHeaders(body === undefined ? {} : { 'content-type': 'application/json' })
  const res = await requestWithRetry(method, `${API_BASE}${path}`, {
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (res.status === 204) return null
  return await res.json()
}

/**
 * 调用 GitHub GraphQL API（Discussion 评论写入只能走 GraphQL）。
 */
async function graphql(query, variables) {
  const headers = authHeaders({ 'content-type': 'application/json' })
  const res = await requestWithRetry('POST', `${API_BASE}/graphql`, {
    headers,
    body: JSON.stringify({ query, variables }),
  })
  const payload = await res.json()
  if (Array.isArray(payload?.errors) && payload.errors.length > 0) {
    throw new Error(`GraphQL 错误：${payload.errors.map(item => item.message).join('；')}`)
  }
  return payload?.data
}

function loadState() {
  if (!existsSync(STATE_FILE)) return { version: 1, updatedAt: null, items: {} }
  try {
    const parsed = JSON.parse(readFileSync(STATE_FILE, 'utf8'))
    return { version: 1, updatedAt: parsed.updatedAt ?? null, items: parsed.items ?? {} }
  } catch (error) {
    fail(`状态文件损坏，无法解析：${STATE_FILE}（${error.message}）`)
  }
}

function saveState(state) {
  mkdirSync(STATE_DIR, { recursive: true })
  state.updatedAt = new Date().toISOString()
  writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
}

function parseKey(key) {
  const match = /^(issue|pr|discussion)#(\d+)$/.exec(String(key ?? ''))
  if (match === null) throw new GuardError(`事项 key 格式错误：${key}（应为 issue#12 / pr#3 / discussion#7）`)
  return { kind: match[1], number: Number(match[2]) }
}

async function fetchMaintainers() {
  const maintainers = new Set()
  try {
    const me = await api('GET', '/user')
    if (me?.login) maintainers.add(me.login)
  } catch {
    // 未认证时拿不到自身账号，后续用仓库 owner 兜底
  }
  const [owner] = REPO.split('/')
  maintainers.add(owner)
  try {
    const collaborators = await api('GET', `/repos/${REPO}/collaborators?affiliation=collaborator&permission=push&per_page=100`)
    for (const collaborator of collaborators ?? []) maintainers.add(collaborator.login)
  } catch {
    // 权限不足时只用 owner + 自身账号判断
  }
  return maintainers
}

async function fetchComments(kind, number) {
  if (kind === 'discussion') {
    return await api('GET', `/repos/${REPO}/discussions/${number}/comments?per_page=100`) ?? []
  }
  return await api('GET', `/repos/${REPO}/issues/${number}/comments?per_page=100`) ?? []
}

/** 拉取三类待处理事项的原始数据。 */
async function fetchRawItems() {
  const items = []
  const issues = await api('GET', `/repos/${REPO}/issues?state=open&per_page=50&sort=created&direction=desc`)
  for (const issue of issues ?? []) {
    if (issue.pull_request) continue
    items.push({
      kind: 'issue',
      number: issue.number,
      title: issue.title,
      url: issue.html_url,
      author: issue.user?.login ?? null,
      createdAt: issue.created_at,
      updatedAt: issue.updated_at,
      body: issue.body ?? '',
      labels: (issue.labels ?? []).map(label => label.name),
    })
  }
  const pulls = await api('GET', `/repos/${REPO}/pulls?state=open&per_page=50&sort=created&direction=desc`)
  for (const pull of pulls ?? []) {
    items.push({
      kind: 'pr',
      number: pull.number,
      title: pull.title,
      url: pull.html_url,
      author: pull.user?.login ?? null,
      createdAt: pull.created_at,
      updatedAt: pull.updated_at,
      body: pull.body ?? '',
      labels: (pull.labels ?? []).map(label => label.name),
    })
  }
  try {
    const discussions = await api('GET', `/repos/${REPO}/discussions?per_page=50`)
    for (const discussion of discussions ?? []) {
      items.push({
        kind: 'discussion',
        number: discussion.number,
        title: discussion.title,
        url: discussion.html_url,
        author: discussion.user?.login ?? null,
        createdAt: discussion.created_at,
        updatedAt: discussion.updated_at,
        body: discussion.body ?? '',
        labels: [],
      })
    }
  } catch (error) {
    process.stderr.write(`Discussions 拉取失败（本轮跳过讨论区）：${error.message}\n`)
  }
  return items
}

/**
 * 判定某事项本轮是否需要值班处理：
 * - 维护者自己发的公告不处理；
 * - 最后一条评论来自维护者，说明已经答复过，不重复回复；
 * - 带机器人签名的评论不重复回复；
 * - 本地状态里已处理、且处理后没有新评论的事项不重复处理。
 */
function decidePending(item, comments, maintainers, record) {
  const authorIsMaintainer = item.author !== null && maintainers.has(item.author)
  const lastComment = comments[comments.length - 1]
  const lastAuthor = lastComment?.user?.login ?? null
  const answeredByMaintainer = lastAuthor !== null && maintainers.has(lastAuthor)
  const hasBotSignature = comments.some(comment => String(comment.body ?? '').includes(SIGNATURE))
  const handledAt = record?.handledAt ? new Date(record.handledAt).getTime() : 0
  const newCommentAfterHandled = handledAt > 0 && lastComment !== undefined
    && new Date(lastComment.created_at).getTime() > handledAt

  if (newCommentAfterHandled) {
    return { pending: true, reason: '处理后有新评论', answeredByMaintainer, hasBotSignature }
  }
  if (record !== undefined && record.status !== 'pending') {
    return { pending: false, reason: '本地状态已处理', answeredByMaintainer, hasBotSignature }
  }
  if (authorIsMaintainer) {
    return { pending: false, reason: '维护者自己发布', answeredByMaintainer, hasBotSignature }
  }
  if (answeredByMaintainer) {
    return { pending: false, reason: '维护者已答复', answeredByMaintainer, hasBotSignature }
  }
  if (hasBotSignature) {
    return { pending: false, reason: '已有机器人回复', answeredByMaintainer, hasBotSignature }
  }
  return { pending: true, reason: '待处理', answeredByMaintainer, hasBotSignature }
}

async function cmdScan() {
  const state = loadState()
  const maintainers = await fetchMaintainers()
  const rawItems = await fetchRawItems()
  const pending = []
  const skipped = []

  for (const item of rawItems) {
    const key = `${item.kind}#${item.number}`
    let comments = []
    try {
      comments = await fetchComments(item.kind, item.number)
    } catch (error) {
      process.stderr.write(`${key} 评论拉取失败，按待处理处理：${error.message}\n`)
    }
    const record = state.items[key]
    const decision = decidePending(item, comments, maintainers, record)
    const entry = {
      key,
      kind: item.kind,
      number: item.number,
      title: item.title,
      url: item.url,
      author: item.author,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      comments: comments.length,
      lastCommentAuthor: comments[comments.length - 1]?.user?.login ?? null,
      lastCommentAt: comments[comments.length - 1]?.created_at ?? null,
      labels: item.labels,
      body: item.body,
      reason: decision.reason,
      seenBefore: record !== undefined,
      status: record?.status ?? 'pending',
    }
    if (decision.pending) {
      pending.push(entry)
      if (record === undefined) {
        state.items[key] = { key, kind: item.kind, number: item.number, status: 'pending', firstSeen: new Date().toISOString(), lastSeen: new Date().toISOString() }
      }
    } else {
      skipped.push(entry)
      if (record === undefined) {
        state.items[key] = { key, kind: item.kind, number: item.number, status: 'ignored', reason: decision.reason, firstSeen: new Date().toISOString(), lastSeen: new Date().toISOString() }
      }
    }
  }

  saveState(state)
  const result = {
    repo: REPO,
    generatedAt: new Date().toISOString(),
    rateLimit: { ...rateLimit },
    counts: { pending: pending.length, skipped: skipped.length, openTotal: rawItems.length },
    pending,
    skipped: skipped.map(entry => ({ key: entry.key, title: entry.title, reason: entry.reason })),
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

/** 收集本地文件清单：git 已跟踪文件 + 未忽略的未跟踪文件 + tmp/ 下的临时文件（排除 outbox 本身）。 */
function collectLocalFiles() {
  const files = new Set()
  const run = (args) => {
    try {
      const output = execFileSync('git', args, {
        cwd: WORKSPACE,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        maxBuffer: 32 * 1024 * 1024,
      })
      // git 以 NUL 分隔路径，必须按 NUL 切分
      for (const entry of output.split('\0')) {
        if (entry.trim()) files.add(resolve(WORKSPACE, entry))
      }
    } catch {
      // 非 git 仓库或命令失败时忽略
    }
  }
  run(['ls-files', '-z'])
  run(['ls-files', '-z', '--others', '--exclude-standard'])

  const tmpRoot = join(WORKSPACE, 'tmp')
  const walk = (dir) => {
    if (!existsSync(dir)) return
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (full.startsWith(OUTBOX_DIR)) continue
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile()) files.add(full)
    }
  }
  walk(tmpRoot)
  return [...files]
}

/** 建立「本地文件行」索引，用于识别正文里是否混入了本地文件原文。 */
function buildLocalLineIndex() {
  const index = new Map()
  for (const file of collectLocalFiles()) {
    try {
      const stat = statSync(file)
      if (!stat.isFile() || stat.size > LOCAL_FILE_MAX_BYTES) continue
      const content = readFileSync(file, 'utf8')
      if (content.includes('\u0000')) continue
      for (const raw of content.split('\n')) {
        const line = raw.trim()
        if (line.length < LOCAL_LINE_MIN_LEN) continue
        const list = index.get(line)
        if (list === undefined) index.set(line, [relative(WORKSPACE, file)])
        else list.push(relative(WORKSPACE, file))
      }
    } catch {
      // 读不到就跳过
    }
  }
  return index
}

/**
 * 发布前拦截：正文里出现本地文件原文、或出现本机绝对路径时拒绝发送。
 */
function guardBody(body, bodyFile) {
  const tracked = new Set(collectLocalFiles())
  if (tracked.has(resolve(bodyFile))) {
    throw new GuardError(`正文文件本身是本地仓库文件（${relative(WORKSPACE, resolve(bodyFile))}），拒绝发布：只允许使用 outbox 里的临时文本。`)
  }

  const home = homedir()
  for (const [label, needle] of [['工作区路径', WORKSPACE], ['用户主目录', home]]) {
    if (needle && needle !== '/' && body.includes(needle)) {
      throw new GuardError(`正文包含本机${label}（${needle}），拒绝发布：本地路径不得出现在 GitHub 评论里。`)
    }
  }

  const index = buildLocalLineIndex()
  const hits = []
  for (const raw of body.split('\n')) {
    const line = raw.trim()
    if (line.length < LOCAL_LINE_MIN_LEN) continue
    const files = index.get(line)
    if (files === undefined) continue
    hits.push({ line, files: [...new Set(files)] })
  }
  const hardHit = hits.find(hit => hit.line.length >= LOCAL_LINE_HARD_LEN)
  if (hardHit !== undefined || hits.length >= 2) {
    const detail = hits.slice(0, 5).map(hit => `${hit.line.slice(0, 60)}… ← ${hit.files[0]}`).join('\n')
    throw new GuardError(`正文疑似包含本地文件内容，拒绝发布：\n${detail}\n请改写为结论 + 文档链接，不要粘贴本地文件原文。`)
  }
}

function appendSignature(body) {
  const trimmed = body.trim()
  if (trimmed.includes(SIGNATURE)) return trimmed
  return `${trimmed}\n\n${SIGNATURE}`
}

/**
 * 发布评论：issue/PR 走 REST 评论接口；Discussion 只能走 GraphQL。
 */
async function postComment(kind, number, body) {
  if (kind === 'discussion') {
    const [owner, repo] = REPO.split('/')
    const data = await graphql(
      'query($owner:String!,$repo:String!,$number:Int!){repository(owner:$owner,name:$repo){discussion(number:$number){id}}}',
      { owner, repo, number },
    )
    const discussionId = data?.repository?.discussion?.id
    if (!discussionId) throw new Error(`Discussion #${number} 不存在或不可见`)
    const result = await graphql(
      'mutation($discussionId:ID!,$body:String!){addDiscussionComment(input:{discussionId:$discussionId, body:$body}){comment{url id}}}',
      { discussionId, body },
    )
    const comment = result?.addDiscussionComment?.comment
    return { url: comment?.url ?? null, id: comment?.id ?? null }
  }
  const posted = await api('POST', `/repos/${REPO}/issues/${number}/comments`, { body: { body } })
  return { url: posted?.html_url ?? null, id: posted?.id ?? null }
}

async function cmdReply(args) {
  const { kind, number } = parseKey(args.key)
  const bodyFile = resolve(String(args.bodyFile ?? ''))
  if (!existsSync(bodyFile)) fail(`正文文件不存在：${bodyFile}`)
  const body = readFileSync(bodyFile, 'utf8')
  if (body.trim().length === 0) fail(`正文文件为空：${bodyFile}`)

  guardBody(body, bodyFile)
  const finalBody = appendSignature(body)

  if (args.dryRun) {
    process.stdout.write(`${JSON.stringify({ ok: true, dryRun: true, key: args.key, body: finalBody, rateLimit }, null, 2)}\n`)
    return
  }

  const posted = await postComment(kind, number, finalBody)
  const result = {
    ok: true,
    key: args.key,
    commentUrl: posted.url,
    commentId: posted.id,
    rateLimit,
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

function cmdMark(args) {
  const key = String(args.key ?? '')
  const status = String(args.status ?? '')
  if (!['replied', 'manual', 'ignored', 'pending'].includes(status)) {
    fail(`状态非法：${status}（可选 replied / manual / ignored / pending）`)
  }
  const state = loadState()
  const previous = state.items[key] ?? {}
  state.items[key] = {
    ...previous,
    key,
    status,
    handledAt: new Date().toISOString(),
    lastSeen: new Date().toISOString(),
    ...(args.card ? { cardId: String(args.card) } : {}),
    ...(args.note ? { note: String(args.note) } : {}),
  }
  saveState(state)
  process.stdout.write(`${JSON.stringify({ ok: true, key, status, cardId: args.card ?? previous.cardId ?? null }, null, 2)}\n`)
}

function cmdState() {
  const state = loadState()
  const items = Object.values(state.items)
  const byStatus = {}
  for (const item of items) byStatus[item.status] = (byStatus[item.status] ?? 0) + 1
  process.stdout.write(`${JSON.stringify({
    stateFile: STATE_FILE,
    updatedAt: state.updatedAt,
    counts: byStatus,
    items: items
      .sort((a, b) => String(b.lastSeen ?? '').localeCompare(String(a.lastSeen ?? '')))
      .slice(0, 30)
      .map(item => ({ key: item.key, status: item.status, cardId: item.cardId ?? null, handledAt: item.handledAt ?? null, note: item.note ?? null })),
  }, null, 2)}\n`)
}

async function cmdRateLimit() {
  const data = await api('GET', '/rate_limit')
  process.stdout.write(`${JSON.stringify({
    core: data?.resources?.core ?? null,
    graphql: data?.resources?.graphql ?? null,
    authenticated: rateLimit.authenticated,
    note: '未认证时 core 限流为 60/h',
  }, null, 2)}\n`)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const command = args._[0]
  switch (command) {
    case 'scan':
      await cmdScan()
      break
    case 'reply':
      await cmdReply(args)
      break
    case 'mark':
      cmdMark(args)
      break
    case 'state':
      cmdState()
      break
    case 'rate-limit':
      await cmdRateLimit()
      break
    default:
      fail('用法：community-duty.mjs <scan|reply|mark|state|rate-limit> [选项]\n'
        + '  scan                     列出本轮待处理事项（JSON）\n'
        + '  reply --key issue#12 --body-file <文件> [--dry-run]\n'
        + '  mark --key issue#12 --status replied|manual|ignored [--card <卡片ID>]\n'
        + '  state                    打印本地状态摘要\n'
        + '  rate-limit               打印 API 剩余额度')
  }
}

// 作为命令行执行时才跑主流程；被 import 时只导出函数，便于单测与探针复用
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    fail(`值班助手执行失败：${error.message}`)
  })
}

export { api, appendSignature, buildLocalLineIndex, graphql, guardBody, postComment }
