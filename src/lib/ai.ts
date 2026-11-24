import type { AISettings, Persona } from '../types'
import { isTauri, platform } from './platform'
import {
  apiKeyFor,
  chatEndpoint,
  isAnthropic,
  modelsEndpoint,
  needsApiKey,
  normalizeBaseUrl,
  thinkingOffBody,
} from './providers'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface AIContext {
  title: string
  headings: string[]
  selection: string
  before: string
  after: string
  related?: { title: string; excerpt: string }[]
  /** 用户可见可删的长期记忆（偏好/目标），只作语气与取舍参考 */
  memories?: string[]
  persona?: Persona
  /** 上下文字数预算（粗略按字符计） */
  budget?: number
}

const SYSTEM = `你是 Inkspire 的写作助手「墨墨」。Inkspire 是一个本地优先的 Markdown 知识工作台。
要求：
1. 直接输出可插入 Markdown 的内容，不要解释你做了什么，不要用「以下是」开头。
2. 保持原文语言与语气；中文与英文、数字之间留一个空格。
3. 除非用户要求，不要重复已有的段落；不要编造事实、数据或引用。
4. 使用 Markdown 结构（标题/列表/引用/代码块）时保持简洁。`

export function buildMessages(mode: string, ctx: AIContext, instruction?: string): ChatMessage[] {
  const budget = Math.max(1500, ctx.budget ?? 6000)
  const personaMap: Record<Persona, string> = {
    gentle: '温和陪伴：先肯定，再给建议，不居高临下。',
    curious: '好奇追问：多用问题帮用户想深一层，但不要绕圈子。',
    strict: '严谨导师：直接指出问题和证据缺口，不粉饰。',
    sassy: '毒舌但心软：可以轻微吐槽，但不冒犯、不打击人。',
  }
  const personaBlock = ctx.persona ? `\n墨墨语气：${personaMap[ctx.persona]}` : ''
  const memoryBlock = (ctx.memories ?? []).filter(Boolean).length
    ? `\n用户长期偏好与目标（可见可删，只用于调整表达与取舍，不要当作事实引用）：\n${(ctx.memories ?? []).slice(0, 8).map((m) => `- ${m.slice(0, 160)}`).join('\n')}`
    : ''
  const head = `文档标题：《${ctx.title || '未命名'}》
${ctx.headings.length ? `已有大纲：${ctx.headings.slice(0, 12).join(' / ')}` : ''}${personaBlock}${memoryBlock}`
  const before = ctx.before.slice(-Math.round(budget * 0.55))
  const after = ctx.after.slice(0, Math.round(budget * 0.15))
  const related = (ctx.related ?? [])
    .slice(0, 3)
    .map((r) => `【${r.title}】${r.excerpt.slice(0, Math.round(budget * 0.08))}`)
    .join('\n')
  const relatedBlock = related ? `\n可能相关的笔记（只作参考，不要编造内容）：\n${related}\n` : ''

  if (mode === 'polish-doc-chunk') {
    return [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: `${head}

这是整篇文章的一部分。请只润色这一段，直接输出处理后的 Markdown：
- 保留本段事实、数字、链接、图片、表格和代码块
- 保留本段已有的标题层级，不要添加文章级一级标题
- 段落拆短，列表统一用「- 」，删除重复和口水话
- 保留 [[双链]]、#标签、图片语法和代码围栏
- 不要输出解释、前言、结语，也不要用 \`\`\`markdown 包住内容

片段：
<<<
${ctx.selection}
>>>`,
      },
    ]
  }
  if (mode === 'polish-doc') {
    return [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: `${head}${relatedBlock}

请对下面整篇文章做一次「润色 + 排版」，直接输出处理后的完整 Markdown 正文：
- 保留原文的事实、观点、数字、链接、图片、表格和代码块，不新增事实
- 统一标题层级：只保留一个一级标题（正文已有则不要再加），二级/三级标题按内容归并
- 段落拆短，列表统一用「- 」，删除重复和口水话
- 保留 [[双链]]、#标签、图片语法和代码围栏
- 不要输出解释、前言、结语，也不要用 \`\`\`markdown 包住全文

正文：
<<<
${ctx.selection}
>>>`,
      },
    ]
  }
  if (mode === 'rewrite') {
    return [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: `${head}

请改写下面这段文字${instruction ? `，要求：${instruction}` : '，让它更清晰、自然、有节奏'}。保持原意与信息量，只输出改写后的段落：

<<<
${ctx.selection}
>>>`,
      },
    ]
  }
  if (mode === 'summarize') {
    return [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: `${head}${relatedBlock}

请总结${ctx.selection ? '下面这段' : '这篇'}文档，输出：
## TL;DR
一句话结论。

## 关键要点
- 3~5 条，每条不超过 30 字。

## 待确认
- 如有信息缺口或矛盾，列出；没有则写「无」。

正文：
<<<
${ctx.selection || `${ctx.before}${ctx.after}`}
>>>`,
      },
    ]
  }
  if (mode === 'translate') {
    const toEnglish = /[\u4e00-\u9fa5]/.test(ctx.selection || ctx.before)
    return [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: `${head}

把下面内容翻译成${toEnglish ? '英文' : '中文'}，保留 Markdown 结构。只输出译文，不要复述原文，不要输出 <<< 与 >>> 分隔符：
<<<
${ctx.selection || (ctx.before + ctx.after).slice(0, 2500) || '（无内容）'}
>>>`,
      },
    ]
  }
  if (mode === 'polish-headings') {
    return [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: `${head}

根据正文内容，为这篇文档生成 3~5 个更清晰的小节标题（Markdown 二级标题），只输出标题列表，每条一行：
正文片段：
<<<
${ctx.before.slice(-1600)}${ctx.after.slice(0, 600)}
>>>`,
      },
    ]
  }
  if (mode === 'custom') {
    return [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: `${head}${relatedBlock}

${instruction || '请基于上下文给出建议。'}

上下文（光标前）：
<<<
${before}
>>>
${ctx.selection ? `\n选中内容：\n<<<\n${ctx.selection}\n>>>` : ''}
${after ? `\n光标后：\n<<<\n${after}\n>>>` : ''}`,
      },
    ]
  }
  // continue
  return [
    { role: 'system', content: SYSTEM },
    {
      role: 'user',
      content: `${head}${relatedBlock}

这是文章在光标之前的内容：
<<<
${before || '（空）'}
>>>

${after ? `这是光标之后的内容（续写应与它自然衔接）：\n<<<\n${after}\n>>>\n` : ''}
请接着写下去，1~2 段，不要重复已有内容，不要写总结，直接从正文开始。`,
    },
  ]
}

const CACHE_PREFIX = 'inkspire:aiCache:'

function hashText(text: string): string {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(36)
}

function cacheKey(settings: AISettings, messages: ChatMessage[]): string {
  return CACHE_PREFIX + hashText(`${settings.provider}|${settings.model}|${JSON.stringify(messages)}`)
}

function readCache(key: string): string | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const obj = JSON.parse(raw)
    if (!obj?.text || Date.now() - obj.t > 3600_000) return null
    return obj.text
  } catch {
    return null
  }
}

function writeCache(key: string, text: string) {
  try {
    const keys = Object.keys(localStorage).filter((k) => k.startsWith(CACHE_PREFIX))
    if (keys.length > 30) keys.slice(0, keys.length - 30).forEach((k) => localStorage.removeItem(k))
    localStorage.setItem(key, JSON.stringify({ t: Date.now(), text }))
  } catch {
    /* ignore */
  }
}

/** 清空本机 AI 结果缓存（设置 → 数据） */
export function clearAICache(): number {
  try {
    const keys = Object.keys(localStorage).filter((k) => k.startsWith(CACHE_PREFIX))
    keys.forEach((k) => localStorage.removeItem(k))
    return keys.length
  } catch {
    return 0
  }
}

export async function streamChat(
  settings: AISettings,
  messages: ChatMessage[],
  onDelta: (text: string) => void,
  signal?: AbortSignal,
  opts: { cache?: boolean } = {},
): Promise<string> {
  const useCache = opts.cache !== false
  const key = cacheKey(settings, messages)
  const cached = useCache ? readCache(key) : null
  if (cached) {
    for (const chunk of cached.match(/[\s\S]{1,24}/g) ?? [cached]) {
      if (signal?.aborted) break
      onDelta(chunk)
      await new Promise((r) => setTimeout(r, 8))
    }
    return cached
  }
  const text = await streamRaw(settings, messages, onDelta, signal)
  if (useCache && text.trim() && !signal?.aborted) writeCache(key, text)
  return text
}

async function streamRaw(
  settings: AISettings,
  messages: ChatMessage[],
  onDelta: (text: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  if (settings.provider === 'demo') return demoStream(messages, onDelta, signal)

  const apiKey = apiKeyFor(settings)
  if (needsApiKey(settings.provider) && !apiKey) {
    throw new Error('还没有配置 API Key，请到设置里填写')
  }
  const baseUrl = normalizeBaseUrl(settings.provider, settings.baseUrl)
  if (!isAnthropic(settings.provider) && !baseUrl) {
    throw new Error('还没有配置 Base URL')
  }

  if (isTauri) {
    return platform.aiStream(
      {
        id: `ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        provider: settings.provider,
        baseUrl,
        apiKey,
        model: settings.model,
        temperature: settings.temperature,
        maxTokens: settings.maxTokens,
        messages,
      },
      onDelta,
      signal,
    )
  }

  if (isAnthropic(settings.provider)) {
    return streamAnthropic(settings, baseUrl, apiKey, messages, onDelta, signal)
  }
  return streamOpenAICompatible(settings, baseUrl, apiKey, messages, onDelta, signal)
}

async function streamOpenAICompatible(
  settings: AISettings,
  baseUrl: string,
  apiKey: string,
  messages: ChatMessage[],
  onDelta: (text: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetch(chatEndpoint(settings.provider, baseUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: settings.model,
      messages,
      stream: true,
      temperature: settings.temperature,
      max_tokens: settings.maxTokens,
      ...thinkingOffBody(settings.provider, settings.model),
    }),
    signal,
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`AI 请求失败 (${res.status}) ${detail.slice(0, 300)}`)
  }
  if (!res.body) throw new Error('当前环境不支持流式响应')
  return readSSE(res.body, (value) => {
    return value?.choices?.[0]?.delta?.content as string | undefined
  }, onDelta)
}

async function streamAnthropic(
  settings: AISettings,
  baseUrl: string,
  apiKey: string,
  messages: ChatMessage[],
  onDelta: (text: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n')
  const body: Record<string, unknown> = {
    model: settings.model,
    max_tokens: settings.maxTokens,
    temperature: settings.temperature,
    stream: true,
    messages: messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role, content: m.content })),
  }
  if (system) body.system = system
  const res = await fetch(chatEndpoint(settings.provider, baseUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Claude 请求失败 (${res.status}) ${detail.slice(0, 300)}`)
  }
  if (!res.body) throw new Error('当前环境不支持流式响应')
  return readSSE(res.body, (value) => {
    if (value?.type === 'content_block_delta') return value?.delta?.text as string | undefined
    return undefined
  }, onDelta)
}

/** 服务端常在流里回 error 事件，过去被当成心跳忽略，界面只会显示空答案 */
function streamError(value: any): string | null {
  if (!value || typeof value !== 'object') return null
  if (value.type === 'error') {
    const err = value.error
    return err?.message ? `AI 错误：${err.message}` : 'AI 流式响应返回错误'
  }
  if (value.error) {
    const err = value.error
    const message = typeof err === 'string' ? err : err?.message
    return message ? `AI 错误：${message}` : 'AI 流式响应返回错误'
  }
  return null
}

async function readSSE(
  body: ReadableStream<Uint8Array>,
  pick: (value: any) => string | undefined,
  onDelta: (text: string) => void,
): Promise<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      const payload = trimmed.startsWith('data:') ? trimmed.slice(5).trim() : trimmed
      if (payload === '[DONE]') continue
      let obj: any
      try {
        obj = JSON.parse(payload)
      } catch {
        continue // 忽略心跳或非 JSON 行
      }
      const message = streamError(obj)
      if (message) throw new Error(message)
      const delta = pick(obj)
      if (delta) {
        full += delta
        onDelta(delta)
      }
    }
  }
  return full
}

/** 演示模式：本地固定内容，验证建议态交互，不联网 */
async function demoStream(
  messages: ChatMessage[],
  onDelta: (text: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.content ?? ''
  const text = `这是演示模式的建议内容——不联网、不产生费用。

当前上下文约 ${Math.min(9999, lastUser.length)} 字。配置真实服务商（DeepSeek / Claude / 本地 Ollama 等）后，这里会换成模型生成的正文。

- 建议态不会自动写入，你点「采纳」才会落笔
- 不想采纳就按 Esc 或「丢弃」，不会有任何痕迹
- 设置里可以切换 13 个服务商，并各自记住 Key`
  const chunks = text.match(/[\s\S]{1,6}/g) ?? [text]
  let full = ''
  for (const chunk of chunks) {
    if (signal?.aborted) break
    full += chunk
    onDelta(chunk)
    await new Promise((r) => setTimeout(r, 22))
  }
  return full
}

/* ------------------------------- 模型列表 / 连接测试 ------------------------------- */

function timeoutSignal(ms: number): AbortSignal {
  const c = new AbortController()
  window.setTimeout(() => c.abort(), ms)
  return c.signal
}

export async function listModels(settings: AISettings): Promise<string[]> {
  if (settings.provider === 'demo') return []
  const apiKey = apiKeyFor(settings)
  const baseUrl = normalizeBaseUrl(settings.provider, settings.baseUrl)
  if (isTauri) {
    return platform.aiModels({ provider: settings.provider, baseUrl, apiKey })
  }
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (isAnthropic(settings.provider)) {
    if (apiKey) headers['x-api-key'] = apiKey
    headers['anthropic-version'] = '2023-06-01'
    headers['anthropic-dangerous-direct-browser-access'] = 'true'
  } else if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`
  }
  const res = await fetch(modelsEndpoint(settings.provider, baseUrl), { headers, signal: timeoutSignal(15_000) }).catch((e) => {
    if (e?.name === 'AbortError') throw new Error('读取模型列表超时（15s）')
    throw e
  })
  if (!res.ok) throw new Error(`读取模型列表失败 (${res.status})`)
  const data: any = await res.json()
  const rows = Array.isArray(data) ? data : data?.data ?? data?.models ?? data?.items ?? []
  return [...new Set(rows.map((x: any) => (typeof x === 'string' ? x : x?.id ?? x?.name)).filter(Boolean))] as string[]
}

function testNetworkError(e: any): never {
  if (e?.name === 'AbortError') throw new Error('连接测试超时（20s）')
  throw new Error(`连接失败：${e?.message ?? e}（可能是 CORS 或网络问题）`)
}

export async function testConnection(settings: AISettings): Promise<string> {
  if (settings.provider === 'demo') return '演示模式无需连接，直接可用'
  const apiKey = apiKeyFor(settings)
  if (needsApiKey(settings.provider) && !apiKey) throw new Error('还没有配置 API Key')
  const baseUrl = normalizeBaseUrl(settings.provider, settings.baseUrl)

  // 桌面端与正式请求一样走 Rust 代理，避免 WebView CORS 让「测试连接」误报
  if (isTauri) {
    return platform.aiTest({
      provider: settings.provider,
      baseUrl,
      apiKey,
      model: settings.model,
      temperature: settings.temperature,
      maxTokens: 20,
    })
  }

  if (isAnthropic(settings.provider)) {
    const res = await fetch(chatEndpoint(settings.provider, baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: settings.model,
        max_tokens: 16,
        messages: [{ role: 'user', content: '回复两个字：在的' }],
      }),
      signal: timeoutSignal(20_000),
    }).catch(testNetworkError)
    if (!res.ok) throw new Error(`连接失败 (${res.status})：${(await res.text()).slice(0, 200)}`)
    const json: any = await res.json()
    return json.content?.[0]?.text ?? 'ok'
  }

  const res = await fetch(chatEndpoint(settings.provider, baseUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: settings.model,
      messages: [{ role: 'user', content: '回复两个字：在的' }],
      stream: false,
      max_tokens: 20,
      ...thinkingOffBody(settings.provider, settings.model),
    }),
    signal: timeoutSignal(20_000),
  }).catch(testNetworkError)
  if (!res.ok) throw new Error(`连接失败 (${res.status})：${(await res.text()).slice(0, 200)}`)
  const json: any = await res.json()
  return json.choices?.[0]?.message?.content ?? 'ok'
}
