/** AI 服务商预设（对齐 ThinRead 的 13 个 provider） */

import type { AISettings, ProviderId } from '../types'

export type { ProviderId }

export interface ProviderPreset {
  id: ProviderId
  label: string
  baseUrl: string
  defaultModel: string
  suggestedModels: string[]
  keyUrl: string
  hint: string
}

export const PROVIDER_PRESETS: ProviderPreset[] = [  {
    id: 'demo',
    label: '演示模式（无需 API Key）',
    baseUrl: '',
    defaultModel: 'demo',
    suggestedModels: ['demo'],
    keyUrl: '',
    hint: '用本地固定样例演示建议态流程，不联网、不产生费用，生成内容不可用于正式写作。',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    defaultModel: 'deepseek-chat',
    suggestedModels: ['deepseek-chat', 'deepseek-reasoner'],
    keyUrl: 'https://platform.deepseek.com/api_keys',
    hint: '中文长文本性价比高。官方端点 api.deepseek.com 同时兼容 /v1。',
  },
  {
    id: 'zhipu',
    label: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4-plus',
    suggestedModels: ['glm-4-plus', 'glm-4-flash', 'glm-4-long'],
    keyUrl: 'https://bigmodel.cn/usercenter/proj-mgmt/apikeys',
    hint: 'API Key 在 bigmodel.cn 的业务空间管理页创建。',
  },
  {
    id: 'anthropic',
    label: 'Anthropic Claude',
    baseUrl: '',
    defaultModel: 'claude-sonnet-4-5',
    suggestedModels: ['claude-sonnet-4-5', 'claude-opus-4-1', 'claude-haiku-4-5'],
    keyUrl: 'https://platform.claude.com/settings/keys',
    hint: '留空 Base URL 走官方端点；Claude 使用独立的 Messages API（x-api-key 鉴权）。',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    suggestedModels: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1', 'o4-mini'],
    keyUrl: 'https://platform.openai.com/api-keys',
    hint: '也可以填任何 OpenAI 兼容网关；模型 ID 以控制台为准。',
  },
  {
    id: 'moonshot',
    label: 'Moonshot Kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    defaultModel: 'moonshot-v1-32k',
    suggestedModels: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k', 'kimi-latest'],
    keyUrl: 'https://platform.moonshot.cn/console/api-keys',
    hint: '长上下文友好，中文写作语感稳定。',
  },
  {
    id: 'alibaba',
    label: '阿里云百炼',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-plus',
    suggestedModels: ['qwen-plus', 'qwen-max', 'qwen-turbo', 'qwen-long'],
    keyUrl: 'https://bailian.console.aliyun.com/cn-beijing/model/settings/api-key',
    hint: '百炼的 OpenAI 兼容地址；不同地域可换成业务空间专属域名。',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'anthropic/claude-sonnet-4.5',
    suggestedModels: ['anthropic/claude-sonnet-4.5', 'deepseek/deepseek-chat', 'openai/gpt-4o'],
    keyUrl: 'https://openrouter.ai/keys',
    hint: '一个 Key 访问多家模型；模型 ID 要带厂商前缀。',
  },
  {
    id: 'opencode',
    label: 'OpenCode Zen / Console',
    baseUrl: 'https://opencode.ai/inference/openai/v1',
    defaultModel: 'qwen3-coder',
    suggestedModels: ['qwen3-coder', 'gpt-5', 'claude-sonnet-4-5', 'deepseek-chat'],
    keyUrl: 'https://opencode.ai/auth',
    hint: 'OpenCode 的按量计费网关；模型很多，保存前可以点「刷新模型列表」。',
  },
  {
    id: 'opencode-go',
    label: 'OpenCode Go',
    baseUrl: 'https://opencode.ai/inference/go/openai/v1',
    defaultModel: 'gpt-5',
    suggestedModels: ['gpt-5', 'grok-4', 'kimi-k2', 'deepseek-chat'],
    keyUrl: 'https://opencode.ai/console/go',
    hint: 'OpenCode Go 是订阅制，模型以账户里的列表为准。',
  },
  {
    id: 'opendesign',
    label: 'OpenDesign',
    baseUrl: 'https://amr-link.open-design.ai/v1',
    defaultModel: 'deepseek-v3',
    suggestedModels: ['deepseek-v3', 'glm-4-plus', 'kimi-k2', 'claude-sonnet-4-5', 'gpt-5'],
    keyUrl: 'https://open-design.ai/cloud/dashboard',
    hint: 'OpenDesign Cloud API Key；和客户端共用套餐额度。',
  },
  {
    id: 'ollama',
    label: '本地 Ollama',
    baseUrl: 'http://localhost:11434/v1',
    defaultModel: 'qwen2.5:7b',
    suggestedModels: ['qwen2.5:7b', 'llama3.1', 'gemma3', 'deepseek-r1:7b'],
    keyUrl: '',
    hint: '本地推理，书和笔记都不出设备；先确保 ollama serve 已启动。',
  },
  {
    id: 'lmstudio',
    label: '本地 LM Studio',
    baseUrl: 'http://localhost:1234/v1',
    defaultModel: 'local-model',
    suggestedModels: [],
    keyUrl: '',
    hint: 'LM Studio 的 OpenAI 兼容端点；本地推理，数据不出设备。',
  },
]

export const DEFAULT_PROVIDER: ProviderId = 'demo'

export function presetOf(id: string | undefined): ProviderPreset {
  return PROVIDER_PRESETS.find((p) => p.id === id) ?? PROVIDER_PRESETS[0]
}

export function isLocalProvider(id: ProviderId): boolean {
  return id === 'demo' || id === 'ollama' || id === 'lmstudio'
}

export function needsApiKey(id: ProviderId): boolean {
  return !['demo', 'ollama', 'lmstudio'].includes(id)
}

/** 语义检索的默认 embedding 模型；没有 embedding 能力的服务商返回空 */
export function defaultEmbeddingModel(id: ProviderId): string {
  switch (id) {
    case 'alibaba':
      return 'text-embedding-v3'
    case 'openai':
      return 'text-embedding-3-small'
    case 'zhipu':
      return 'embedding-3'
    case 'openrouter':
      return 'openai/text-embedding-3-small'
    case 'ollama':
      return 'nomic-embed-text'
    case 'lmstudio':
      return 'text-embedding-nomic-embed-text-v1.5'
    default:
      return ''
  }
}

export function defaultImageModel(id: ProviderId): string {
  switch (id) {
    case 'alibaba':
      return 'qwen-image-3.0-pro'
    case 'openai':
      return 'gpt-image-1'
    default:
      return ''
  }
}

export function isAnthropic(id: ProviderId): boolean {
  return id === 'anthropic'
}

/** 统一 Base URL：留空用预设；本地服务补齐 /v1；去掉尾部斜杠 */
export function normalizeBaseUrl(id: ProviderId, raw: string): string {
  const preset = presetOf(id)
  let base = (raw || '').trim().replace(/\/+$/, '')
  if (!base) base = preset.baseUrl
  if (!base) return ''
  if (isLocalProvider(id) && !/\/v1$/i.test(base)) base = `${base}/v1`
  return base
}

export function chatEndpoint(id: ProviderId, baseUrl: string): string {
  const base = normalizeBaseUrl(id, baseUrl)
  if (id === 'anthropic') {
    if (/\/v1$/i.test(base)) return `${base}/messages`
    return `${base || 'https://api.anthropic.com'}/v1/messages`
  }
  return `${base}/chat/completions`
}

export function modelsEndpoint(id: ProviderId, baseUrl: string): string {
  const base = normalizeBaseUrl(id, baseUrl)
  if (id === 'anthropic') return /\/v1$/i.test(base) ? `${base}/models` : `${base || 'https://api.anthropic.com'}/v1/models`
  return `${base}/models`
}

/** 当前 provider 的 key：优先 keys[provider]，缺失时兼容旧的单一 apiKey */
export function apiKeyFor(settings: AISettings): string {
  const stored = settings.keys?.[settings.provider]
  if (stored) return stored
  return settings.apiKey ?? ''
}

export function providerLabel(id: string | undefined): string {
  return presetOf(id).label
}

/** 各家的「思考模式」开关：写作场景默认关闭，首 token 从几十秒降到 1 秒内 */
export function thinkingOffBody(id: ProviderId, model: string): Record<string, unknown> {
  if (id === 'alibaba' && /qwen3|qwen4|qwen-flash|qwen-plus|qwen-max/i.test(model)) {
    return { enable_thinking: false }
  }
  if ((id === 'deepseek' || id === 'opencode' || id === 'opencode-go') && /deepseek/i.test(model)) {
    return { thinking: { type: 'disabled' } }
  }
  return {}
}
