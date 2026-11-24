import { idb } from './db'
import { isTauri, platform, type RustBlock, type VaultFile } from './platform'
import { PROVIDER_PRESETS } from './providers'
import { apiKeyFor, defaultEmbeddingModel, presetOf } from './providers'
import introRaw from '../../docs/initial/项目介绍.md?raw'
import usageRaw from '../../docs/initial/项目使用.md?raw'
import markdownRaw from '../../docs/initial/Markdown 支持.md?raw'
import { countWords, deriveTitle, makePreview, parseFrontMatter, serializeFrontMatter } from './md'
import type {
  AISettings,
  AppSettings,
  Document,
  DocumentVersion,
  FrontMatter,
  ContextSource,
  Mood,
  SearchHit,
  SearchResult,
  SidebarTab,
} from '../types'

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'paper',
  fontSize: 16,
  lineWidth: 760,
  fontFamily: 'sans',
  sourceMode: false,
  showPet: true,
  petLines: true,
  typewriter: false,
  focusMode: false,
  autosaveMs: 800,
  privacyLocalOnly: false,
  sidebarTab: 'files',
  persona: 'gentle',
  ai: {
    provider: 'demo',
    baseUrl: '',
    apiKey: '',
    keys: {},
    model: 'demo',
    embeddingModel: '',
    imageModel: '',
    temperature: 0.7,
    maxTokens: 1200,
    contextChars: 6000,
    dailyCharBudget: 0,
    enabled: false,
  },
}

export type SettingsPatch = Partial<Omit<AppSettings, 'ai'>> & { ai?: Partial<AISettings> }

export interface AiLedgerEntry {
  at: number
  model: string
  kind: 'chat' | 'embedding' | 'image'
  inputTokens: number
  outputTokens: number
  images: number
  cost: number
  currency: 'CNY'
}

interface ModelPrice {
  input: number
  output: number
  image1k?: number
  image2k?: number
  imageInput?: number
}

/** 预置公开单价（元 / 百万 tokens，图片为元 / 张）；实际以百炼账单为准 */
const MODEL_PRICES: Record<string, ModelPrice> = {
  'qwen3.8-flash': { input: 0.8, output: 2.7 },
  'qwen-image-3.0-pro': { input: 0, output: 0, image1k: 0.25, image2k: 0.5, imageInput: 0.02 },
  'qwen-image-3.0': { input: 0, output: 0, image1k: 0.18, image2k: 0.18, imageInput: 0.02 },
  'text-embedding-v3': { input: 0.514, output: 0 },
}

function priceFor(model: string): ModelPrice | null {
  const id = model.trim().toLowerCase()
  if (!id) return null
  const key = Object.keys(MODEL_PRICES).find((name) => id === name || id.endsWith(`/${name}`) || id.startsWith(`${name}-`))
  return key ? MODEL_PRICES[key] : null
}

/** 粗略 token 估算：中文按 1 字 ≈ 0.7 token，其它字符按 4 字符 ≈ 1 token */
function estimateTokens(chars: number): number {
  return Math.max(0, Math.round(chars / 1.6))
}

export interface VaultState {
  ready: boolean
  docs: Document[]
  activeId: string | null
  settings: AppSettings
  sidebar: SidebarTab
  searchQuery: string
  mood: Mood
  petLine: string | null
  toast: { id: string; text: string; kind: 'info' | 'success' | 'error' } | null
  saving: boolean
  savingDocId: string | null
  /** 最近一次保存失败的文档；顶栏据此显示可重试的错误态 */
  saveErrorDocId: string | null
  savedAt: number
  savedAtByDoc: Record<string, number>
  aiBusy: boolean
  paletteOpen: boolean
  settingsOpen: boolean
  importOpen: boolean
  versionsOpen: boolean
  recent: string[]
  vaultRoot?: string
  aiUsage: { calls: number; inputChars: number; outputChars: number }
  aiUsageDay: { day: string; chars: number; calls: number }
  aiLedger: AiLedgerEntry[]
  /** 文件树手动顺序：path -> order；编辑正文不会改变它 */
  treeOrder: Record<string, number>
  blocksByPath: Record<string, RustBlock[]>
  folders: string[]
}

let seq = 0

function uid(): string {
  return `${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

/* ---------------- 本地相似度向量（无外部 embedding，纯本机 n-gram 哈希） ---------------- */

const VEC_DIM = 128
const vectorCache = new Map<string, { key: string; vec: Float32Array }>()

function hashToken(token: string): number {
  let h = 2166136261
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h) % VEC_DIM
}

function vectorize(text: string): Float32Array {
  const vec = new Float32Array(VEC_DIM)
  const sample = text.toLowerCase().slice(0, 20000)
  const words = sample.match(/[a-z0-9_]{2,}|[\u4e00-\u9fa5]/g) ?? []
  for (let i = 0; i < words.length; i++) {
    vec[hashToken(words[i])] += 1
    if (i + 1 < words.length) vec[hashToken(words[i] + words[i + 1])] += 0.8
  }
  let norm = 0
  for (let i = 0; i < VEC_DIM; i++) norm += vec[i] * vec[i]
  norm = Math.sqrt(norm) || 1
  for (let i = 0; i < VEC_DIM; i++) vec[i] /= norm
  return vec
}

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0
  for (let i = 0; i < VEC_DIM; i++) dot += a[i] * b[i]
  return dot
}

function docVector(doc: Document): Float32Array {
  const key = `${doc.updatedAt}:${doc.content.length}`
  const cached = vectorCache.get(doc.id)
  if (cached && cached.key === key) return cached.vec
  const vec = vectorize(doc.content)
  vectorCache.set(doc.id, { key, vec })
  return vec
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/{2,}/g, '/')
}

function ensureMd(p: string): string {
  const f = normalizePath(p).trim()
  if (!f) return '未命名.md'
  return /\.md$/i.test(f) ? f : `${f}.md`
}

interface DocMetaCache {
  path: string
  favorite?: boolean
  versions?: DocumentVersion[]
  createdAt?: number
}

function normalizeSettings(settings: AppSettings): AppSettings {
  const ai = { ...DEFAULT_SETTINGS.ai, ...(settings.ai ?? {}) }
  if (!PROVIDER_PRESETS.some((p) => p.id === ai.provider)) ai.provider = 'demo'
  if (!ai.keys || typeof ai.keys !== 'object') ai.keys = {}
  if (ai.provider === 'demo') {
    ai.baseUrl = ''
    ai.model = ai.model || 'demo'
  }
  return { ...DEFAULT_SETTINGS, ...settings, ai }
}

function dayKey(ts = Date.now()): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 语义命中时优先展示包含查询词的那一行；没有词面命中就取第一段正文 */
function semanticSnippet(body: string, query: string): { line: number; text: string } {
  const terms = [...new Set((query.match(/[\u4e00-\u9fa5]{2,}|[A-Za-z0-9]{2,}/g) ?? []).map((t) => t.toLowerCase()))].slice(0, 24)
  const lower = body.toLowerCase()
  let at = -1
  for (const term of terms) {
    const idx = lower.indexOf(term)
    if (idx >= 0 && (at < 0 || idx < at)) at = idx
  }
  if (at < 0) {
    const lines = body.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim()
      if (!line || line.startsWith('#') || line.startsWith('```') || line.startsWith('---')) continue
      if (line.length >= 12) return { line: i, text: line.slice(0, 180) }
    }
    return { line: 0, text: (body.trim().split('\n')[0] ?? '').slice(0, 180) }
  }
  const line = body.slice(0, at).split('\n').length - 1
  const rows = body.split('\n')
  const text = (rows[line] ?? '').trim().slice(0, 180)
  return { line: Math.max(0, line), text }
}

function readTreeOrder(): Record<string, number> {
  try {
    const raw = localStorage.getItem('inkspire:treeOrder')
    const parsed = raw ? JSON.parse(raw) : {}
    if (!parsed || typeof parsed !== 'object') return {}
    const out: Record<string, number> = {}
    for (const [path, value] of Object.entries(parsed)) {
      const n = Number(value)
      if (path && Number.isFinite(n)) out[path] = n
    }
    return out
  } catch {
    return {}
  }
}

function writeTreeOrder(order: Record<string, number>) {
  try {
    localStorage.setItem('inkspire:treeOrder', JSON.stringify(order))
  } catch {
    /* ignore */
  }
}

function parentDir(path: string): string {
  const at = path.lastIndexOf('/')
  return at < 0 ? '' : path.slice(0, at)
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

function docFromFile(f: VaultFile, meta?: DocMetaCache): Document {
  const { fm } = parseFrontMatter(f.content)
  return {
    id: f.path,
    path: f.path,
    title: deriveTitle(f.content, f.path),
    frontMatter: fm,
    content: f.content,
    createdAt: meta?.createdAt ?? f.modified,
    updatedAt: f.modified,
    wordCount: countWords(f.content),
    preview: makePreview(f.content),
    favorite: !!meta?.favorite,
    versions: meta?.versions ?? [],
  }
}

export class Vault {
  state: VaultState = {
    ready: false,
    docs: [],
    activeId: null,
    settings: DEFAULT_SETTINGS,
    sidebar: 'files',
    searchQuery: '',
    mood: 'idle',
    petLine: null,
    toast: null,
    saving: false,
    savingDocId: null,
    saveErrorDocId: null,
    savedAt: 0,
    savedAtByDoc: {},
    aiBusy: false,
    paletteOpen: false,
    settingsOpen: false,
    importOpen: false,
    versionsOpen: false,
    recent: [],
    aiUsage: { calls: 0, inputChars: 0, outputChars: 0 },
    aiUsageDay: { day: dayKey(), chars: 0, calls: 0 },
    aiLedger: [],
    treeOrder: {},
    blocksByPath: {},
    folders: [],
  }

  private initPromise: Promise<void> | null = null
  private secretTimers = new Map<string, number>()
  private settingsTimer = 0
  private settingsInflight: Promise<void> = Promise.resolve()
  private saveQueues = new Map<string, Promise<boolean>>()
  private removing = new Set<string>()
  discardPending = false

  setBlocks(path: string, blocks: RustBlock[]) {
    this.set({ blocksByPath: { ...this.state.blocksByPath, [path]: blocks } })
  }

  recordUsage(inputChars: number, outputChars: number) {
    const prev = this.state.aiUsage
    const next = {
      calls: prev.calls + 1,
      inputChars: prev.inputChars + Math.max(0, inputChars),
      outputChars: prev.outputChars + Math.max(0, outputChars),
    }
    const today = dayKey()
    const prevDay = this.state.aiUsageDay
    const day = {
      day: today,
      chars: (prevDay.day === today ? prevDay.chars : 0) + Math.max(0, inputChars) + Math.max(0, outputChars),
      calls: (prevDay.day === today ? prevDay.calls : 0) + 1,
    }
    this.set({ aiUsage: next, aiUsageDay: day })
    const price = priceFor(this.state.settings.ai.model)
    const inputTokens = estimateTokens(inputChars)
    const outputTokens = estimateTokens(outputChars)
    this.pushLedger({
      at: Date.now(),
      model: this.state.settings.ai.model || 'chat',
      kind: 'chat',
      inputTokens,
      outputTokens,
      images: 0,
      cost: price ? (inputTokens * price.input + outputTokens * price.output) / 1_000_000 : 0,
      currency: 'CNY',
    })
    try {
      localStorage.setItem('inkspire:aiUsage', JSON.stringify(next))
      localStorage.setItem('inkspire:aiUsageDay', JSON.stringify(day))
    } catch {
      /* ignore */
    }
  }

  private pushLedger(entry: AiLedgerEntry) {
    const rows = [entry, ...this.state.aiLedger].slice(0, 400)
    this.set({ aiLedger: rows })
    try {
      localStorage.setItem('inkspire:aiLedger', JSON.stringify(rows))
    } catch {
      /* quota */
    }
  }

  recordEmbeddingUsage(chars: number, model: string) {
    const price = priceFor(model)
    const inputTokens = estimateTokens(chars)
    this.pushLedger({
      at: Date.now(),
      model,
      kind: 'embedding',
      inputTokens,
      outputTokens: 0,
      images: 0,
      cost: price ? (inputTokens * price.input) / 1_000_000 : 0,
      currency: 'CNY',
    })
  }

  recordImageUsage(opts: { model: string; images?: number; size?: string; edited?: boolean }) {
    const model = opts.model || this.state.settings.ai.imageModel || 'image'
    const images = Math.max(1, opts.images ?? 1)
    const is2k = /2k|2048|1536/.test(opts.size ?? '') && !/1024/.test(opts.size ?? '')
    const price = priceFor(model)
    const perImage = price ? (is2k ? price.image2k ?? price.image1k : price.image1k) ?? 0 : 0
    const input = opts.edited && price?.imageInput ? price.imageInput * images : 0
    const prev = this.state.aiUsage
    this.set({ aiUsage: { ...prev, calls: prev.calls + 1 } })
    try {
      localStorage.setItem('inkspire:aiUsage', JSON.stringify(this.state.aiUsage))
    } catch {
      /* ignore */
    }
    this.pushLedger({
      at: Date.now(),
      model,
      kind: 'image',
      inputTokens: 0,
      outputTokens: 0,
      images,
      cost: perImage * images + input,
      currency: 'CNY',
    })
  }

  resetAiLedger() {
    this.set({ aiLedger: [] })
    try {
      localStorage.removeItem('inkspire:aiLedger')
    } catch {
      /* ignore */
    }
    this.flash('AI 费用账本已清零', 'success')
  }

  /** 今日 AI 字符预算；0 表示不限制 */
  aiBudgetState(extra = 0): { ok: boolean; used: number; limit: number; remaining: number } {
    const limit = Math.max(0, Math.round(this.state.settings.ai.dailyCharBudget ?? 0))
    const used = this.state.aiUsageDay.day === dayKey() ? this.state.aiUsageDay.chars : 0
    if (!limit) return { ok: true, used, limit, remaining: Infinity }
    return { ok: used + Math.max(0, extra) <= limit, used, limit, remaining: Math.max(0, limit - used) }
  }

  /** 入口统一拦截；超预算时提示并返回 false */
  checkAiBudget(extra = 0): boolean {
    const budget = this.aiBudgetState(extra)
    if (budget.ok) return true
    this.flash(
      `今天的 AI 字符预算已用完（${budget.used.toLocaleString()} / ${budget.limit.toLocaleString()}）。可在设置里调高、清零，或明天再用。`,
      'error',
    )
    return false
  }

  resetAiUsageToday() {
    const day = { day: dayKey(), chars: 0, calls: 0 }
    this.set({ aiUsageDay: day })
    try {
      localStorage.setItem('inkspire:aiUsageDay', JSON.stringify(day))
    } catch {
      /* ignore */
    }
    this.flash('今日 AI 用量已清零', 'success')
  }
  private listeners = new Set<() => void>()
  private saveTimers = new Map<string, number>()
  private toastTimer = 0
  private petTimer = 0
  private idleTimer = 0

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  getSnapshot = () => this.state

  private set(patch: Partial<VaultState>) {
    this.state = { ...this.state, ...patch }
    this.listeners.forEach((l) => l())
  }

  /* ------------------------------- 初始化 ------------------------------- */

  async init() {
    if (!this.initPromise) this.initPromise = this.doInit()
    return this.initPromise
  }

  /** 只迁移旧版种子文档；用户主动删掉初始文档后不再每次启动补回来 */
  private async migrateLegacyDocs(list: Document[]): Promise<Document[]> {
    let next = [...list]
    const legacy = [
      { path: '开始使用 Inkspire.md', prefix: '# 开始使用 Inkspire' },
      { path: '让知识长出来.md', prefix: '# 让知识长出来' },
      { path: '指南/Markdown 速查.md', prefix: '# Markdown 速查' },
    ]
    for (const item of legacy) {
      const doc = next.find((d) => d.path === item.path)
      const body = doc ? parseFrontMatter(doc.content).body.trimStart() : ''
      if (!doc || !body.includes(item.prefix)) continue
      next = next.filter((d) => d.id !== doc.id)
      try {
        if (isTauri) await platform.vaultDelete(item.path)
        else await idb.del('docs', doc.id)
      } catch {
        /* 旧种子文件已不存在时忽略 */
      }
    }
    return next
  }

  private async doInit() {
    if (isTauri) return this.initTauri()
    const [docs, saved] = await Promise.all([idb.getAll<Document>('docs'), idb.get<AppSettings>('settings', 'app')])
    const settings = normalizeSettings({ ...DEFAULT_SETTINGS, ...(saved ?? {}), ai: { ...DEFAULT_SETTINGS.ai, ...(saved?.ai ?? {}) } })
    let list = (docs ?? []).filter((d) => d && d.id && typeof d.content === 'string')
    // 去重：同一路径只保留最近更新的一份（防止并发初始化产生重复种子）
    const byPath = new Map<string, Document>()
    for (const d of list) {
      const cur = byPath.get(d.path)
      if (!cur || d.updatedAt > cur.updatedAt) {
        if (cur) void idb.del('docs', cur.id)
        byPath.set(d.path, d)
      } else {
        void idb.del('docs', d.id)
      }
    }
    list = [...byPath.values()]
    const seeded = localStorage.getItem('inkspire:seeded') === '1'
    if (!list.length) {
      if (!seeded) {
        list = seedDocuments()
        await Promise.all(list.map((d) => idb.put('docs', d)))
      }
    } else {
      list = await this.migrateLegacyDocs(list)
    }
    if (list.length || !seeded) localStorage.setItem('inkspire:seeded', '1')
    list.sort((a, b) => b.updatedAt - a.updatedAt)
    const last = localStorage.getItem('inkspire:lastDoc')
    const active = list.find((d) => d.id === last) ?? list[0]
    const folders = [...new Set(list.flatMap((d) => d.path.split('/').slice(0, -1).map((_, i, arr) => arr.slice(0, i + 1).join('/'))))]
    let aiUsageDay = { day: dayKey(), chars: 0, calls: 0 }
    let aiLedger: AiLedgerEntry[] = []
    try {
      const rawDay = localStorage.getItem('inkspire:aiUsageDay')
      if (rawDay) {
        const parsed = JSON.parse(rawDay)
        if (parsed?.day === dayKey()) aiUsageDay = { day: parsed.day, chars: Number(parsed.chars) || 0, calls: Number(parsed.calls) || 0 }
      }
      const rawLedger = localStorage.getItem('inkspire:aiLedger')
      if (rawLedger) {
        const parsed = JSON.parse(rawLedger)
        if (Array.isArray(parsed)) aiLedger = parsed.filter((x) => x && typeof x.cost === 'number').slice(0, 400)
      }
    } catch {
      /* ignore */
    }
    const treeOrder = this.mergeTreeOrder(list)
    this.applyTheme(settings)
    this.set({ docs: list, settings, ready: true, activeId: active?.id ?? null, savedAt: active?.updatedAt ?? 0, folders, aiUsageDay, aiLedger, treeOrder })
    if (active) this.pushRecent(active.id)
  }

  /** 桌面端：磁盘 vault 是内容唯一真相源，收藏/版本快照缓存在本地 meta 表 */
  private async initTauri() {
    const [fileSettings, metas, info, dirs] = await Promise.all([
      platform.loadSettings(),
      idb.getAll<DocMetaCache>('meta'),
      platform.vaultInfo(),
      platform.vaultDirs().catch(() => [] as string[]),
    ])
    const settings = normalizeSettings({
      ...DEFAULT_SETTINGS,
      ...(fileSettings ?? {}),
      ai: { ...DEFAULT_SETTINGS.ai, ...((fileSettings as any)?.ai ?? {}) },
    } as AppSettings)

    // 明文 Key 迁移到系统钥匙串，成功后再从设置文件里抹掉
    let migrated = false
    const legacyKeys: Record<string, string> = { ...(settings.ai.keys ?? {}) }
    if (settings.ai.apiKey) legacyKeys[settings.ai.provider] = settings.ai.apiKey
    for (const [provider, value] of Object.entries(legacyKeys)) {
      if (!value) continue
      try {
        await platform.secretSet(provider, value)
        migrated = true
      } catch {
        /* 钥匙串不可用时保留明文，避免丢 Key */
      }
    }
    if (migrated) {
      settings.ai.keys = {}
      settings.ai.apiKey = ''
      await platform.saveSettings({ ...settings, ai: { ...settings.ai, keys: {}, apiKey: '' } })
    }

    const files = await platform.vaultList()
    const metaMap = new Map((metas ?? []).map((m) => [m.path, m]))
    let list: Document[]
    const seeded = localStorage.getItem('inkspire:seeded') === '1'
    if (!files.length) {
      list = seeded ? [] : seedDocuments().map((d) => ({ ...d, id: d.path }))
      for (const d of list) await platform.vaultWrite(d.path, d.content)
    } else {
      list = files.map((f) => docFromFile(f, metaMap.get(f.path)))
      list = await this.migrateLegacyDocs(list)
    }
    if (list.length || !seeded) localStorage.setItem('inkspire:seeded', '1')
    list.sort((a, b) => b.updatedAt - a.updatedAt)
    const last = localStorage.getItem('inkspire:lastDoc')
    const active = list.find((d) => d.id === last) ?? list[0]
    this.applyTheme(settings)
    const folders = [...new Set([...dirs, ...list.flatMap((d) => d.path.split('/').slice(0, -1).map((_, i, arr) => arr.slice(0, i + 1).join('/')))])]
    let aiUsage = { calls: 0, inputChars: 0, outputChars: 0 }
    let aiUsageDay = { day: dayKey(), chars: 0, calls: 0 }
    let aiLedger: AiLedgerEntry[] = []
    try {
      const raw = localStorage.getItem('inkspire:aiUsage')
      if (raw) aiUsage = { ...aiUsage, ...JSON.parse(raw) }
      const rawDay = localStorage.getItem('inkspire:aiUsageDay')
      if (rawDay) {
        const parsed = JSON.parse(rawDay)
        if (parsed?.day === dayKey()) aiUsageDay = { day: parsed.day, chars: Number(parsed.chars) || 0, calls: Number(parsed.calls) || 0 }
      }
      const rawLedger = localStorage.getItem('inkspire:aiLedger')
      if (rawLedger) {
        const parsed = JSON.parse(rawLedger)
        if (Array.isArray(parsed)) aiLedger = parsed.filter((x) => x && typeof x.cost === 'number').slice(0, 400)
      }
    } catch {
      /* ignore */
    }
    const treeOrder = this.mergeTreeOrder(list)
    this.set({
      aiUsage,
      aiUsageDay,
      aiLedger,
      treeOrder,
      docs: list,
      settings,
      ready: true,
      activeId: active?.id ?? null,
      savedAt: active?.updatedAt ?? 0,
      vaultRoot: info?.root,
    })
    if (active) this.pushRecent(active.id)
    if (settings.showPet) void platform.petOpen()
    else void platform.petClose()
    void platform.indexRebuild().catch(() => undefined)
  }

  private persistMeta(doc: Document) {
    if (!isTauri) return
    void idb.put('meta', {
      path: doc.path,
      favorite: doc.favorite,
      versions: doc.versions,
      createdAt: doc.createdAt,
    })
  }

  private applyTheme(settings: AppSettings) {
    document.documentElement.dataset.theme = settings.theme
  }

  /* ------------------------------- 设置 ------------------------------- */

  async updateSettings(patch: SettingsPatch) {
    const prevAi = this.state.settings.ai
    const settings = { ...this.state.settings, ...patch, ai: { ...this.state.settings.ai, ...(patch.ai ?? {}) } }
    if (patch.theme) this.applyTheme(settings)
    this.set({ settings })

    // 桌面端：Key 写系统钥匙串，配置文件与 IndexedDB 只留非敏感字段
    if (isTauri && patch.ai) {
      const providers = new Set([...Object.keys(prevAi.keys ?? {}), ...Object.keys(settings.ai.keys ?? {})])
      for (const provider of providers) {
        const before = prevAi.keys?.[provider] ?? ''
        const after = settings.ai.keys?.[provider] ?? ''
        if (before !== after) this.scheduleSecret(provider, after)
      }
      if (prevAi.apiKey !== settings.ai.apiKey) this.scheduleSecret(settings.ai.provider, settings.ai.apiKey)
    }
    if (patch.showPet !== undefined) {
      if (settings.showPet) void platform.petOpen()
      else void platform.petClose()
    }
    this.scheduleSettingsPersist()
  }

  /** 设置写入防抖：滑块/输入框连续变化时只落盘一次，避免旧值覆盖新值 */
  private scheduleSettingsPersist() {
    window.clearTimeout(this.settingsTimer)
    this.settingsTimer = window.setTimeout(() => {
      this.settingsTimer = 0
      this.settingsInflight = this.settingsInflight.then(() => this.persistSettings()).catch(() => undefined)
    }, 400)
  }

  private async persistSettings() {
    if (!this.state.ready) return
    const settings = this.state.settings
    const persisted = isTauri ? { ...settings, ai: { ...settings.ai, keys: {}, apiKey: '' } } : settings
    await idb.put('settings', persisted, 'app')
    await platform.saveSettings(persisted)
  }

  async flushSettings() {
    window.clearTimeout(this.settingsTimer)
    this.settingsTimer = 0
    this.settingsInflight = this.settingsInflight.catch(() => undefined).then(() => this.persistSettings())
    try {
      await this.settingsInflight
    } catch (e: any) {
      this.flash(`设置保存失败：${e?.message ?? e}`, 'error')
    }
  }

  private scheduleSecret(provider: string, value: string) {
    if (!isTauri) return
    const existing = this.secretTimers.get(provider)
    if (existing) window.clearTimeout(existing)
    this.secretTimers.set(
      provider,
      window.setTimeout(() => {
        void platform.secretSet(provider, value).catch(() => undefined)
      }, 500),
    )
  }

  async ensureProviderKey(provider: string): Promise<string> {
    const existing = this.state.settings.ai.keys?.[provider] || ''
    if (!isTauri || existing) return existing
    try {
      const value = await platform.secretGet(provider)
      if (value) {
        const settings = {
          ...this.state.settings,
          ai: {
            ...this.state.settings.ai,
            apiKey: this.state.settings.ai.provider === provider ? value : this.state.settings.ai.apiKey,
            keys: { ...(this.state.settings.ai.keys ?? {}), [provider]: value },
          },
        }
        this.set({ settings })
      }
      return value
    } catch {
      return ''
    }
  }

  async loadProviderKey(provider: string): Promise<string> {
    if (!isTauri) return this.state.settings.ai.keys?.[provider] ?? ''
    try {
      return await platform.secretGet(provider)
    } catch {
      return ''
    }
  }

  findContext(query: string, excludeId: string, limit = 3): ContextSource[] {
    const terms = new Set<string>()
    const stop = new Set(['什么', '这篇', '一篇', '一下', '如何', '怎么', '可以', '我们', '这个', '那个', '以及', '是否', '请问', '帮我'])
    for (const part of query.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
      if (!part) continue
      if (/^[a-z0-9]+$/.test(part)) {
        if (part.length >= 2) terms.add(part)
        continue
      }
      if (part.length >= 2 && part.length <= 6 && !stop.has(part)) terms.add(part)
      for (let i = 0; i + 2 <= part.length; i++) {
        const bigram = part.slice(i, i + 2)
        if (!stop.has(bigram)) terms.add(bigram)
      }
    }
    if (!terms.size) return []
    const found: ContextSource[] = []
    for (const doc of this.state.docs) {
      if (doc.id === excludeId) continue
      const body = doc.content.toLowerCase()
      const title = doc.title.toLowerCase()
      let score = 0
      let first = -1
      for (const term of terms) {
        const at = body.indexOf(term)
        if (at >= 0) {
          let count = 0
          let from = at
          while (count < 20) {
            const next = body.indexOf(term, from)
            if (next < 0) break
            count++
            from = next + term.length
          }
          score += Math.min(6, count)
          if (first < 0 || at < first) first = at
        }
        if (title.includes(term)) score += 4
      }
      if (score <= 0 || first < 0) continue
      const start = Math.max(0, first - 120)
      const excerpt = doc.content.slice(start, Math.min(doc.content.length, first + 420)).replace(/\n{2,}/g, '\n').trim()
      const line = doc.content.slice(0, first).split('\n').length - 1
      found.push({ id: doc.id, title: doc.title, line: Math.max(0, line), excerpt, score })
    }
    return found.sort((a, b) => b.score - a.score).slice(0, limit)
  }

  /**
   * 问答/相关笔记用：优先真 embedding 召回，失败或无命中时回退词法。
   * 不抛错，调用方总能拿到可用的上下文。
   */
  async findContextSmart(
    query: string,
    excludeId: string,
    limit = 3,
  ): Promise<{ sources: ContextSource[]; mode: 'semantic' | 'keyword'; note?: string }> {
    const keyword = this.findContext(query, excludeId, limit)
    if (!this.state.settings.ai.enabled || this.state.settings.privacyLocalOnly) {
      return { sources: keyword, mode: 'keyword' }
    }
    try {
      const results = await this.searchSemantic(query, undefined, Math.max(limit * 2, 8))
      const seen = new Set<string>()
      const sources: ContextSource[] = []
      for (const row of results) {
        if (row.docId === excludeId || seen.has(row.docId)) continue
        seen.add(row.docId)
        const hit = row.hits[0]
        sources.push({
          id: row.docId,
          title: row.title,
          line: hit?.line ?? 0,
          excerpt: hit?.text ?? '',
          score: hit?.score ?? 0,
        })
        if (sources.length >= limit) break
      }
      for (const item of keyword) {
        if (sources.length >= limit) break
        if (!seen.has(item.id)) {
          seen.add(item.id)
          sources.push(item)
        }
      }
      if (!sources.length) {
        return { sources: keyword, mode: 'keyword', note: '语义没有命中，已回退关键词' }
      }
      return { sources, mode: 'semantic' }
    } catch (e: any) {
      return {
        sources: keyword,
        mode: 'keyword',
        note: `语义召回不可用，已回退关键词：${e?.message ?? e}`,
      }
    }
  }

  async searchRemote(query: string): Promise<SearchResult[]> {
    if (!isTauri) return this.search(query)
    const hits = await platform.searchDocs(query, 60)
    const out: SearchResult[] = []
    for (const h of hits) {
      const doc = this.state.docs.find((d) => d.path === h.path)
      if (!doc) continue
      out.push({
        docId: doc.id,
        title: h.title || doc.title,
        path: h.path,
        hits: [{ docId: doc.id, line: h.line, text: h.snippet, start: 0, length: 0, score: h.score }],
      })
    }
    return out
  }

  /* ------------------------------- 文档 ------------------------------- */

  get active(): Document | null {
    return this.state.docs.find((d) => d.id === this.state.activeId) ?? null
  }

  getDoc(id: string): Document | null {
    return this.state.docs.find((d) => d.id === id) ?? null
  }

  async setActive(id: string) {
    this.set({ activeId: id })
    localStorage.setItem('inkspire:lastDoc', id)
    this.pushRecent(id)
  }

  setActiveId(id: string | null) {
    this.set({ activeId: id })
    if (id) localStorage.setItem('inkspire:lastDoc', id)
  }

  private pushRecent(id: string) {
    const recent = [id, ...this.state.recent.filter((x) => x !== id)].slice(0, 8)
    this.set({ recent })
  }

  async createFolder(parent: string, name: string) {
    const clean = name.trim().replace(/[\\/:*?"<>|]/g, '').replace(/^\/+|\/+$/g, '')
    if (!clean) return null
    const path = parent ? `${parent}/${clean}` : clean
    if (isTauri) {
      try {
        await platform.vaultMkdir(path)
      } catch (e: any) {
        this.flash(`创建文件夹失败：${e?.message ?? e}`, 'error')
        return null
      }
    }
    this.set({ folders: [...new Set([...this.state.folders, path])] })
    this.flash('文件夹已创建', 'success')
    return path
  }

  async setVaultPath(path: string) {
    await this.updateSettings({ vaultPath: path.trim() })
    await this.flushSettings()
    this.flash('保存路径已更新，正在重新加载…', 'success')
    window.dispatchEvent(new Event('pagehide'))
    window.setTimeout(() => window.location.reload(), 800)
  }

  /** 每日笔记：同一天只建一篇，第二次打开直接回到原文 */
  async openDailyNote(): Promise<Document> {
    const now = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const key = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
    const path = `日记/${key}.md`
    const existing = this.state.docs.find((d) => d.path === path)
    if (existing) {
      await this.setActive(existing.id)
      this.flash(`回到 ${key} 的日记`, 'info')
      return existing
    }
    const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][now.getDay()]
    const content = `# ${key} ${week}\n\n> 今天的纸已经铺好，先写三行再想结构。\n\n## 今日要事\n\n- [ ] \n\n## 想法与摘录\n\n\n\n## 今日复盘\n\n- 做成了：\n- 卡住了：\n- 明天第一步：\n`
    const doc = await this.createDoc({
      title: `${key} 日记`,
      path,
      content,
      frontMatter: { tags: ['日记', 'daily'] },
    })
    this.flash(`已打开 ${key} 的日记`, 'success')
    return doc
  }

  /** 内置笔记模板：会议纪要 / 读书笔记 / 周报 / 项目计划 */
  async createFromTemplate(kind: 'meeting' | 'reading' | 'weekly' | 'project'): Promise<Document> {
    const now = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
    const templates = {
      meeting: {
        title: `会议纪要 ${date}`,
        content: `# 会议纪要 ${date}\n\n## 背景\n\n\n## 参会人\n\n- \n\n## 结论\n\n1. \n\n## 行动项\n\n- [ ] 负责人 · 截止日期 · 事项\n`,
      },
      reading: {
        title: '读书笔记 · 书名',
        content: `# 读书笔记 · 书名\n\n> 作者 / 章节 / 读完日期\n\n## 一句话结论\n\n\n## 关键观点\n\n1. \n\n## 原文摘录\n\n> \n\n## 我的反驳与联想\n\n\n## 可以行动的一步\n\n- [ ] \n`,
      },
      weekly: {
        title: `周报 ${date}`,
        content: `# 周报 ${date}\n\n## 本周产出\n\n- \n\n## 关键进展\n\n1. \n\n## 阻塞与风险\n\n- \n\n## 下周计划\n\n- [ ] \n`,
      },
      project: {
        title: '项目计划 · 项目名',
        content: `# 项目计划 · 项目名\n\n## 目标\n\n\n## 范围\n\n- 做：\n- 不做：\n\n## 里程碑\n\n| 时间 | 交付物 | 负责人 |\n| --- | --- | --- |\n|  |  |  |\n\n## 风险\n\n- \n`,
      },
    } as const
    const tpl = templates[kind]
    const doc = await this.createDoc({
      title: tpl.title,
      path: `${tpl.title}.md`,
      content: tpl.content,
      frontMatter: { tags: ['模板'] },
    })
    this.flash('模板已创建，替换占位内容即可', 'success')
    return doc
  }

  /** 文件树顺序：新建文档放最前，导入书籍按章节顺序追加 */
  nextTreeOrder(edge: 'top' | 'bottom' = 'bottom'): number {
    const values = Object.values(this.state.treeOrder)
    if (!values.length) return edge === 'top' ? 0 : 1000
    return edge === 'top' ? Math.min(...values) - 1000 : Math.max(...values) + 1000
  }

  private persistTreeOrder(order: Record<string, number>) {
    this.set({ treeOrder: order })
    writeTreeOrder(order)
  }

  private mergeTreeOrder(docs: Document[]): Record<string, number> {
    const stored = readTreeOrder()
    const paths = new Set(docs.map((d) => d.path))
    let changed = false
    for (const path of Object.keys(stored)) {
      if (!paths.has(path)) {
        delete stored[path]
        changed = true
      }
    }
    let next = Math.max(0, ...Object.values(stored))
    for (const doc of docs) {
      if (stored[doc.path] !== undefined) continue
      next += 1000
      stored[doc.path] = next
      changed = true
    }
    if (changed || Object.keys(stored).length !== docs.length) writeTreeOrder(stored)
    return stored
  }

  private orderedDocsIn(dir: string): Document[] {
    return this.state.docs
      .filter((doc) => parentDir(doc.path) === dir)
      .sort((a, b) => {
        const oa = this.state.treeOrder[a.path]
        const ob = this.state.treeOrder[b.path]
        if (oa !== undefined && ob !== undefined) return oa - ob
        if (oa !== undefined) return -1
        if (ob !== undefined) return 1
        return b.updatedAt - a.updatedAt
      })
  }

  /** 拖到文件夹：移动到目录末尾；拖到另一个文档时再按位置排序 */
  async moveDocToFolder(id: string, folder: string): Promise<string | null> {
    const doc = this.getDoc(id)
    if (!doc) return null
    const next = folder ? `${folder}/${basename(doc.path)}` : basename(doc.path)
    if (next === doc.path) return doc.path
    await this.rename(id, next)
    const moved = this.state.docs.find((d) => d.id === (isTauri ? next : id))
    if (!moved || moved.path !== next) return null
    const order = { ...this.state.treeOrder }
    order[moved.path] = this.nextTreeOrder('bottom')
    this.persistTreeOrder(order)
    return moved.path
  }

  /** 手动拖动排序；跨文件夹时先移动文件，再按目标位置重排 */
  async reorderDoc(dragId: string, targetId: string, after: boolean): Promise<boolean> {
    const drag = this.getDoc(dragId)
    const target = this.getDoc(targetId)
    if (!drag || !target || drag.id === target.id) return false
    const targetDir = parentDir(target.path)
    let movedPath = drag.path
    if (parentDir(drag.path) !== targetDir) {
      const nextPath = await this.moveDocToFolder(drag.id, targetDir)
      if (!nextPath) return false
      movedPath = nextPath
    }
    const dragged = this.state.docs.find((d) => d.path === movedPath)
    if (!dragged) return false
    const siblings = this.orderedDocsIn(targetDir).filter((d) => d.id !== dragged.id)
    const at = siblings.findIndex((d) => d.id === target.id)
    const insertAt = at < 0 ? siblings.length : at + (after ? 1 : 0)
    siblings.splice(insertAt, 0, dragged)
    const order = { ...this.state.treeOrder }
    siblings.forEach((doc, i) => {
      order[doc.path] = (i + 1) * 1000
    })
    this.persistTreeOrder(order)
    return true
  }

  async createDoc(opts: { path?: string; content?: string; title?: string; frontMatter?: Partial<FrontMatter> } = {}) {
    const now = Date.now()
    const title = opts.title ?? '未命名'
    const fm: FrontMatter = {
      title,
      tags: [],
      aliases: [],
      created: new Date(now).toISOString(),
      ...(opts.frontMatter ?? {}),
      extra: { ...(opts.frontMatter?.extra ?? {}) },
    }
    const body = opts.content ?? `# ${title}\n\n开始写点什么吧。\n`
    const content = `${serializeFrontMatter(fm)}\n${body}`
    let path = ensureMd(opts.path ?? `${title}.md`)
    let n = 2
    while (this.state.docs.some((d) => d.path === path)) path = ensureMd(`${title} ${n++}.md`)
    const doc: Document = {
      id: isTauri ? path : uid(),
      path,
      title: deriveTitle(content, path),
      frontMatter: fm,
      content,
      createdAt: now,
      updatedAt: now,
      wordCount: countWords(content),
      preview: makePreview(content),
      favorite: false,
      versions: [],
    }
    if (isTauri) await platform.vaultWrite(path, content)
    else await idb.put('docs', doc)
    this.persistMeta(doc)
    const order = { ...this.state.treeOrder, [doc.path]: this.nextTreeOrder('top') }
    this.persistTreeOrder(order)
    this.set({ docs: [doc, ...this.state.docs] })
    await this.setActive(doc.id)
    this.flash('新建文档', 'success')
    this.pet('happy', '这想法不错！')
    return doc
  }

  async importDoc(doc: Omit<Document, 'id' | 'createdAt' | 'updatedAt' | 'versions' | 'favorite' | 'title' | 'wordCount' | 'preview'> & { title?: string }, treeOrder?: number) {
    const now = Date.now()
    let path = ensureMd(doc.path)
    let n = 2
    while (this.state.docs.some((d) => d.path === path)) {
      const base = path.replace(/\.md$/i, '')
      path = `${base} ${n++}.md`
    }
    const full: Document = {
      id: isTauri ? path : uid(),
      path,
      title: doc.title || deriveTitle(doc.content, path),
      frontMatter: doc.frontMatter,
      content: doc.content,
      createdAt: now,
      updatedAt: now,
      wordCount: countWords(doc.content),
      preview: makePreview(doc.content),
      favorite: false,
      versions: [],
      importMeta: doc.importMeta,
    }
    if (isTauri) await platform.vaultWrite(path, doc.content)
    else await idb.put('docs', full)
    this.persistMeta(full)
    const order = { ...this.state.treeOrder, [full.path]: treeOrder ?? this.nextTreeOrder('bottom') }
    this.persistTreeOrder(order)
    this.set({ docs: [full, ...this.state.docs] })
    return full
  }

  /** 编辑内容落盘（防抖由编辑器负责）；同一文档串行写，避免 tmp 文件互相覆盖 */
  async saveContent(id: string, content: string, reason: DocumentVersion['reason'] = 'autosave'): Promise<boolean> {
    const prev = this.saveQueues.get(id) ?? Promise.resolve()
    const task = prev.catch(() => undefined).then(() => this.writeContent(id, content, reason))
    this.saveQueues.set(id, task)
    try {
      return await task
    } finally {
      if (this.saveQueues.get(id) === task) this.saveQueues.delete(id)
    }
  }

  private async writeContent(id: string, content: string, reason: DocumentVersion['reason']): Promise<boolean> {
    if (this.discardPending || this.removing.has(id)) return false
    const doc = this.getDoc(id)
    if (!doc) return false
    if (doc.content === content) return true
    const now = Date.now()
    const { fm } = parseFrontMatter(content)
    const versions = [...doc.versions]
    const last = versions[versions.length - 1]
    if (!last || now - last.at > 45_000 || Math.abs(content.length - last.content.length) > 400) {
      versions.push({ id: uid(), at: now, content, reason })
      while (versions.length > 40) versions.shift()
    }
    let updatedAt = now
    this.set({ savingDocId: id, saveErrorDocId: null })
    try {
      if (isTauri) {
        const res = await platform.vaultWrite(doc.path, content)
        updatedAt = res.modified || now
      }
    } catch (e: any) {
      this.set({ savingDocId: null, saveErrorDocId: id })
      this.flash(`保存失败：${e?.message ?? e}`, 'error')
      return false
    }
    const next: Document = {
      ...doc,
      content,
      frontMatter: fm,
      title: deriveTitle(content, doc.path),
      updatedAt,
      wordCount: countWords(content),
      preview: makePreview(content),
      versions,
    }
    this.set({
      docs: this.state.docs.map((d) => (d.id === id ? next : d)),
      savedAt: updatedAt,
      savedAtByDoc: { ...this.state.savedAtByDoc, [id]: updatedAt },
      savingDocId: null,
      saveErrorDocId: null,
    })
    if (!isTauri) await idb.put('docs', next)
    this.persistMeta(next)
    return true
  }

  /** 桌面端：重新扫描磁盘，合并外部修改（iCloud / Git / 其它编辑器） */
  async refreshFromDisk(): Promise<{ changed: number; added: number; removed: number; activeChanged: boolean }> {
    if (!isTauri) return { changed: 0, added: 0, removed: 0, activeChanged: false }
    const [files, metas, dirs] = await Promise.all([
      platform.vaultList(),
      idb.getAll<DocMetaCache>('meta'),
      platform.vaultDirs().catch(() => [] as string[]),
    ])
    const metaMap = new Map((metas ?? []).map((m) => [m.path, m]))
    const prev = new Map(this.state.docs.map((d) => [d.path, d]))
    const nextPaths = new Set(files.map((f) => f.path))
    let changed = 0
    let added = 0
    const next: Document[] = files.map((file) => {
      const old = prev.get(file.path)
      if (old && old.content === file.content) return old
      const fresh = docFromFile(file, metaMap.get(file.path))
      if (!old) {
        added += 1
        return fresh
      }
      changed += 1
      return {
        ...fresh,
        createdAt: old.createdAt,
        favorite: old.favorite,
        versions: old.versions,
      }
    })
    let removed = 0
    for (const path of prev.keys()) {
      if (!nextPaths.has(path)) removed += 1
    }
    next.sort((a, b) => b.updatedAt - a.updatedAt)
    const folders = [...new Set([...dirs, ...next.flatMap((d) => d.path.split('/').slice(0, -1).map((_, i, arr) => arr.slice(0, i + 1).join('/')))])]
    const prevActive = this.state.activeId ? prev.get(this.state.docs.find((d) => d.id === this.state.activeId)?.path ?? '') : undefined
    const active = next.find((d) => d.id === this.state.activeId) ?? next[0]
    const activeChanged = active?.id !== this.state.activeId || (!!prevActive && prevActive.content !== active?.content)
    const treeOrder = this.mergeTreeOrder(next)
    this.set({
      docs: next,
      folders,
      treeOrder,
      activeId: active?.id ?? null,
      savedAt: active?.updatedAt ?? 0,
    })
    if (active) localStorage.setItem('inkspire:lastDoc', active.path)
    return { changed, added, removed, activeChanged }
  }

  async renameFolder(path: string, rawName: string) {
    const oldPath = path.replace(/\/+$/, '')
    if (!oldPath) return
    const clean = rawName.trim().replace(/[\\/:*?"<>|]/g, '').replace(/^\/+|\/+$/g, '')
    if (!clean) {
      this.flash('文件夹名不能为空', 'error')
      return
    }
    const parent = oldPath.split('/').slice(0, -1).join('/')
    const nextPath = parent ? `${parent}/${clean}` : clean
    if (nextPath === oldPath) return
    if (this.state.folders.includes(nextPath) || this.state.docs.some((d) => d.path === nextPath || d.path.startsWith(`${nextPath}/`))) {
      this.flash('已有同名文件夹', 'error')
      return
    }
    const affected = this.state.docs.filter((d) => d.path === oldPath || d.path.startsWith(`${oldPath}/`))
    const active = this.state.docs.find((d) => d.id === this.state.activeId)
    const migrateOrder = () => {
      const order = { ...this.state.treeOrder }
      let changed = false
      for (const key of Object.keys(order)) {
        if (key === oldPath || key.startsWith(`${oldPath}/`)) {
          order[nextPath + key.slice(oldPath.length)] = order[key]
          delete order[key]
          changed = true
        }
      }
      if (changed) {
        this.set({ treeOrder: order })
        writeTreeOrder(order)
      }
      return order
    }

    if (isTauri) {
      try {
        await platform.vaultRenameDir(oldPath, nextPath)
      } catch (e: any) {
        this.flash(e?.message ?? '文件夹重命名失败', 'error')
        return
      }
      for (const doc of affected) {
        const newPath = nextPath + doc.path.slice(oldPath.length)
        const meta = await idb.get<Record<string, unknown>>('meta', doc.path)
        if (meta) {
          await idb.put('meta', { ...meta, path: newPath }, newPath)
          await idb.del('meta', doc.path)
        }
      }
      if (active) {
        const newPath = nextPath + active.path.slice(oldPath.length)
        localStorage.setItem('inkspire:lastDoc', newPath)
      }
      migrateOrder()
      this.flash('文件夹已重命名，正在重新加载…', 'success')
      window.setTimeout(() => window.location.reload(), 300)
      return
    }

    const updated = this.state.docs.map((doc) => {
      if (!(doc.path === oldPath || doc.path.startsWith(`${oldPath}/`))) return doc
      return { ...doc, path: nextPath + doc.path.slice(oldPath.length) }
    })
    for (const doc of affected) {
      const newPath = nextPath + doc.path.slice(oldPath.length)
      const meta = await idb.get<Record<string, unknown>>('meta', doc.path)
      if (meta) {
        await idb.put('meta', { ...meta, path: newPath }, newPath)
        await idb.del('meta', doc.path)
      }
    }
    for (const doc of updated) {
      if (affected.some((a) => a.id === doc.id)) await idb.put('docs', doc)
    }
    const folders = this.state.folders.map((f) => (f === oldPath || f.startsWith(`${oldPath}/`) ? nextPath + f.slice(oldPath.length) : f))
    const treeOrder = migrateOrder()
    this.set({ docs: updated, folders, treeOrder, savedAt: Date.now() })
    this.flash('文件夹已重命名', 'success')
    window.dispatchEvent(new Event('inkspire:vault-restored'))
  }

  async rename(id: string, newPath: string) {    const doc = this.getDoc(id)
    if (!doc) return
    let path = ensureMd(newPath)
    if (this.state.docs.some((d) => d.id !== id && d.path === path)) {
      this.flash('已存在同名文档', 'error')
      return
    }
    const { body } = parseFrontMatter(doc.content)
    const fm = { ...doc.frontMatter }
    // 文件名变化时同步 H1 之外只改 title 字段
    fm.title = path.split('/').pop()!.replace(/\.md$/i, '')
    const content = `${serializeFrontMatter(fm)}\n${body}`
    const nextId = isTauri ? path : doc.id
    const next = {
      ...doc,
      id: nextId,
      path,
      frontMatter: fm,
      content,
      title: fm.title,
      updatedAt: Date.now(),
      versions: [...doc.versions, { id: uid(), at: Date.now(), content, reason: 'manual' as const }].slice(-40),
    }
    if (isTauri) {
      try {
        await platform.vaultRename(doc.path, path)
        await platform.vaultWrite(path, content)
        await idb.del('meta', doc.path)
      } catch (e: any) {
        this.flash(e?.message ?? '重命名失败', 'error')
        return
      }
    }
    const order = { ...this.state.treeOrder }
    if (order[doc.path] !== undefined) {
      order[next.path] = order[doc.path]
      delete order[doc.path]
      this.persistTreeOrder(order)
    }
    this.set({
      docs: this.state.docs.map((d) => (d.id === id ? next : d)),
      activeId: this.state.activeId === id ? nextId : this.state.activeId,
    })
    if (!isTauri) await idb.put('docs', next)
    this.persistMeta(next)
    localStorage.setItem('inkspire:lastDoc', nextId)
    if (this.state.activeId === nextId) window.dispatchEvent(new Event('inkspire:vault-restored'))
    this.flash('已重命名', 'success')
  }

  async toggleFavorite(id: string) {
    const doc = this.getDoc(id)
    if (!doc) return
    const next = { ...doc, favorite: !doc.favorite }
    this.set({ docs: this.state.docs.map((d) => (d.id === id ? next : d)) })
    if (!isTauri) await idb.put('docs', next)
    this.persistMeta(next)
  }

  async remove(id: string) {
    const doc = this.getDoc(id)
    if (!doc) return
    this.removing.add(id)
    try {
      await this.saveQueues.get(id)?.catch(() => undefined)
      if (isTauri) {
        try {
          await platform.vaultDelete(doc.path)
          await idb.del('meta', doc.path)
        } catch (e: any) {
          this.flash(e?.message ?? '删除失败', 'error')
          return
        }
      }
      const remaining = this.state.docs.filter((d) => d.id !== id)
      const order = { ...this.state.treeOrder }
      delete order[doc.path]
      this.persistTreeOrder(order)
      this.set({ docs: remaining })
      if (!isTauri) await idb.del('docs', id)
      if (this.state.activeId === id) {
        const next = remaining[0]
        this.set({ activeId: next?.id ?? null })
      }
      this.flash('已删除', 'info')
    } finally {
      this.removing.delete(id)
    }
  }

  async restoreVersion(docId: string, versionId: string) {
    const doc = this.getDoc(docId)
    const v = doc?.versions.find((x) => x.id === versionId)
    if (!doc || !v) return
    const versions = [...doc.versions, { id: uid(), at: Date.now(), content: doc.content, reason: 'manual' as const }].slice(-40)
    const { fm } = parseFrontMatter(v.content)
    const next = {
      ...doc,
      content: v.content,
      frontMatter: fm,
      versions,
      updatedAt: Date.now(),
      title: deriveTitle(v.content, doc.path),
      wordCount: countWords(v.content),
      preview: makePreview(v.content),
    }
    if (isTauri) {
      try {
        await platform.vaultWrite(doc.path, v.content)
      } catch (e: any) {
        this.flash(`回滚失败：${e?.message ?? e}`, 'error')
        return
      }
    }
    this.discardPending = true
    this.set({ docs: this.state.docs.map((d) => (d.id === docId ? next : d)) })
    if (!isTauri) await idb.put('docs', next)
    this.persistMeta(next)
    window.dispatchEvent(new CustomEvent('inkspire:vault-restored'))
    this.flash('已回滚到该版本', 'success')
  }

  /* ------------------------------- UI 状态 ------------------------------- */

  setSidebar(tab: SidebarTab) {
    this.set({ sidebar: tab })
    void this.updateSettings({ sidebarTab: tab })
  }

  setSearchQuery(q: string) {
    this.set({ searchQuery: q })
  }

  setModal(patch: Partial<Pick<VaultState, 'paletteOpen' | 'settingsOpen' | 'importOpen' | 'versionsOpen'>>) {
    this.set(patch)
  }

  setAiBusy(v: boolean) {
    this.set({ aiBusy: v })
  }

  flash(text: string, kind: 'info' | 'success' | 'error' = 'info') {
    window.clearTimeout(this.toastTimer)
    this.set({ toast: { id: uid(), text, kind } })
    this.toastTimer = window.setTimeout(() => this.set({ toast: null }), 2400)
  }

  dismissToast() {
    window.clearTimeout(this.toastTimer)
    this.set({ toast: null })
  }

  pet(mood: Mood, line?: string, revert = 2400) {
    window.clearTimeout(this.petTimer)
    if (line && this.state.settings.petLines) this.set({ mood, petLine: line })
    else this.set({ mood })
    if (isTauri) void platform.petMood(mood, line && this.state.settings.petLines ? line : null)
    if (revert > 0) {
      this.petTimer = window.setTimeout(() => {
        this.set({ mood: 'idle', petLine: null })
      }, revert)
    }
  }

  noteTyping() {
    if (this.state.mood !== 'writing') this.pet('writing', undefined, 0)
    window.clearTimeout(this.idleTimer)
    this.idleTimer = window.setTimeout(() => {
      this.pet('happy', '写好啦，真棒！✦', 2600)
    }, 1500)
  }

  search(query: string, limit = 100): SearchResult[] {
    const q = query.trim()
    if (!q) return []
    const raw = q.toLowerCase().split(/\s+/).filter(Boolean)
    const terms = new Set<string>(raw)
    // 中文长词补二元组：既能整词命中，也能处理「自然语言式」查询
    for (const part of raw) {
      if (/[\u4e00-\u9fa5]/.test(part) && part.length > 2) {
        for (let i = 0; i + 2 <= part.length; i++) terms.add(part.slice(i, i + 2))
      }
    }
    const termList = [...terms]
    const queryVec = vectorize(q)
    const results: (SearchResult & { coverage: number; similarity: number })[] = []
    for (const doc of this.state.docs) {
      const { body } = parseFrontMatter(doc.content)
      const lower = body.toLowerCase()
      const titleLower = doc.title.toLowerCase()
      const matched = termList.filter((t) => lower.includes(t) || titleLower.includes(t))
      const similarity = cosine(queryVec, docVector(doc))
      if (!matched.length && similarity < 0.12) continue
      const coverage = matched.length / termList.length
      const titleHits = matched.filter((t) => titleLower.includes(t)).length
      const lines = body.split('\n')
      const hits: SearchHit[] = []
      for (let i = 0; i < lines.length && hits.length < 6; i++) {
        const l = lines[i].toLowerCase()
        let best = -1
        let bestLen = 0
        for (const term of matched) {
          const idx = l.indexOf(term)
          if (idx !== -1 && (best === -1 || idx < best)) {
            best = idx
            bestLen = term.length
          }
        }
        if (best !== -1) {
          // 搜索结果不展示 base64 图片正文，否则一条命中会把整段 data URI 塞进侧栏
          const cleanText = lines[i]
            .replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi, '[本地图片]')
            .slice(0, 220)
          hits.push({ docId: doc.id, line: i, text: cleanText, start: best, length: bestLen, score: 1 })
        }
      }
      if (!hits.length) hits.push({ docId: doc.id, line: 0, text: doc.preview || doc.title, start: 0, length: 0, score: 0 })
      hits[0].score += coverage * 10 + titleHits * 3 + similarity * 6
      results.push({ docId: doc.id, title: doc.title, path: doc.path, hits, coverage, similarity })
    }
    return results
      .sort((a, b) => b.coverage * 10 + b.similarity * 6 - (a.coverage * 10 + a.similarity * 6) || b.hits.length - a.hits.length)
      .map(({ coverage: _coverage, similarity: _similarity, ...result }) => result)
      .slice(0, limit)
  }

  /** 真 embedding 语义检索：调用服务商 /embeddings，向量缓存在本机 assets store */
  async searchSemantic(
    query: string,
    onProgress?: (done: number, total: number) => void,
    limit = 20,
  ): Promise<SearchResult[]> {
    const q = query.trim()
    if (!q) return []
    const ai = this.state.settings.ai
    if (!ai.enabled) throw new Error('先在设置里启用 AI')
    if (ai.provider === 'demo' || ai.provider === 'anthropic') {
      throw new Error('当前服务商没有 embedding；请选阿里云百炼、OpenAI 或本地 Ollama')
    }
    const model = ai.embeddingModel || defaultEmbeddingModel(ai.provider)
    if (!model) throw new Error('当前服务商没有配置 embedding 模型')
    let key = apiKeyFor(ai)
    if (!key) key = await this.ensureProviderKey(ai.provider)
    if (!key && ai.provider !== 'ollama' && ai.provider !== 'lmstudio') throw new Error('还没有配置 API Key')
    const base = (ai.baseUrl || presetOf(ai.provider).baseUrl).trim().replace(/\/$/, '')

    const embed = async (input: string[]): Promise<number[][]> => {
      if (isTauri) {
        return platform.aiEmbeddings({ provider: ai.provider, baseUrl: base, apiKey: key, model, input })
      }
      const res = await fetch(`${base}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(key ? { Authorization: `Bearer ${key}` } : {}),
        },
        body: JSON.stringify({ model, input }),
      })
      if (!res.ok) throw new Error(`embedding 请求失败 (${res.status})：${(await res.text()).slice(0, 160)}`)
      const data: any = await res.json()
      const rows = Array.isArray(data?.data) ? data.data : []
      return rows.map((r: any) => (Array.isArray(r.embedding) ? r.embedding : []))
    }

    const docs = [...this.state.docs].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 200)
    const vectors = new Map<string, number[]>()
    const missing: Document[] = []
    for (const doc of docs) {
      const cached = await idb.get<{ model: string; updatedAt: number; vector: number[] }>('assets', `semantic:${doc.id}`)
      if (cached && cached.model === model && cached.updatedAt === doc.updatedAt && cached.vector.length) {
        vectors.set(doc.id, cached.vector)
      } else {
        missing.push(doc)
      }
    }

    let done = 0
    onProgress?.(0, missing.length)
    for (let i = 0; i < missing.length; i += 8) {
      const batch = missing.slice(i, i + 8)
      const texts = batch.map((doc) => {
        const body = parseFrontMatter(doc.content).body
        return `${doc.title}\n${body.slice(0, 1200)}`
      })
      const out = await embed(texts)
      this.recordEmbeddingUsage(texts.join('').length, model)
      for (let j = 0; j < batch.length; j++) {
        const vector = out[j] ?? []
        if (!vector.length) continue
        vectors.set(batch[j].id, vector)
        await idb.put('assets', { model, updatedAt: batch[j].updatedAt, vector }, `semantic:${batch[j].id}`)
      }
      done += batch.length
      onProgress?.(done, missing.length)
    }

    const [qv] = await embed([q])
    this.recordEmbeddingUsage(q.length, model)
    if (!qv?.length) return []
    const scored = docs
      .map((doc) => {
        const v = vectors.get(doc.id)
        if (!v || v.length !== qv.length) return null
        let dot = 0
        let na = 0
        let nb = 0
        for (let i = 0; i < v.length; i++) {
          dot += v[i] * qv[i]
          na += v[i] * v[i]
          nb += qv[i] * qv[i]
        }
        const score = dot / (Math.sqrt(na) * Math.sqrt(nb) || 1)
        return { doc, score }
      })
      .filter((x): x is { doc: Document; score: number } => !!x && x.score > 0.18)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)

    return scored.map(({ doc, score }) => {
      const snippet = semanticSnippet(parseFrontMatter(doc.content).body, q)
      return {
        docId: doc.id,
        title: doc.title,
        path: doc.path,
        hits: [{ docId: doc.id, line: snippet.line, text: snippet.text || doc.preview || doc.title, start: 0, length: 0, score }],
      }
    })
  }

  mentions(docTitle: string, excludeId?: string): { docId: string; title: string; line: number; excerpt: string }[] {    const needle = docTitle.trim().toLowerCase()
    if (!needle) return []
    const out: { docId: string; title: string; line: number; excerpt: string }[] = []
    for (const doc of this.state.docs) {
      if (doc.id === excludeId) continue
      if (doc.title.toLowerCase() === needle) continue
      const body = parseFrontMatter(doc.content).body
      const stripped = body.replace(/\[\[[^\]]+\]\]/g, (m) => ' '.repeat(m.length))
      const lower = stripped.toLowerCase()
      let from = 0
      while (out.filter((x) => x.docId === doc.id).length < 3) {
        const idx = lower.indexOf(needle, from)
        if (idx === -1) break
        const line = stripped.slice(0, idx).split('\n').length - 1
        const text = stripped.split('\n')[line]?.trim() ?? ''
        out.push({ docId: doc.id, title: doc.title, line, excerpt: text.slice(0, 120) })
        from = idx + needle.length
      }
    }
    return out.slice(0, 20)
  }

  backlinks(docTitle: string): { docId: string; title: string; count: number }[] {
    const t = docTitle.toLowerCase()
    const out: { docId: string; title: string; count: number }[] = []
    for (const doc of this.state.docs) {
      if (doc.title.toLowerCase() === t) continue
      const count = (doc.content.match(/\[\[([^\]\n]+?)\]\]/g) ?? []).filter((raw) => {
        const inner = raw.slice(2, -2).split('|')[0].split('#')[0].trim().toLowerCase()
        return inner === t
      }).length
      if (count) out.push({ docId: doc.id, title: doc.title, count })
    }
    return out
  }

  async importBackup(data: { docs: Document[]; settings?: AppSettings; treeOrder?: Record<string, number> }) {
    const byPath = new Map<string, Document>()
    for (const d of data.docs ?? []) {
      if (!d || !d.path || typeof d.content !== 'string') continue
      const path = ensureMd(d.path)
      byPath.set(path, { ...d, id: isTauri ? path : d.id || path, path })
    }
    const docs = [...byPath.values()]
    if (!docs.length) {
      this.flash('备份里没有可恢复的文档', 'error')
      return
    }

    if (isTauri) {
      // 桌面端必须写回磁盘，否则重启后磁盘会覆盖 IndexedDB，恢复内容直接消失
      for (const d of docs) {
        await platform.vaultWrite(d.path, d.content)
        await idb.put('meta', { path: d.path, favorite: d.favorite, versions: d.versions, createdAt: d.createdAt })
      }
      const keep = new Set(docs.map((d) => d.path))
      for (const old of this.state.docs) {
        if (!keep.has(old.path)) await platform.vaultDelete(old.path).catch(() => undefined)
      }
    } else {
      await idb.clear('docs')
      await Promise.all(docs.map((d) => idb.put('docs', d)))
    }

    if (data.settings) {
      const settings = { ...DEFAULT_SETTINGS, ...data.settings, ai: { ...DEFAULT_SETTINGS.ai, ...(data.settings.ai ?? {}), apiKey: '', keys: {} } }
      this.applyTheme(settings)
      await idb.put('settings', settings, 'app')
      await platform.saveSettings(isTauri ? { ...settings, ai: { ...settings.ai, keys: {}, apiKey: '' } } : settings)
      this.set({ settings })
    }
    const sorted = [...docs].sort((a, b) => b.updatedAt - a.updatedAt)
    const active = sorted[0]
    const folders = [...new Set(sorted.flatMap((d) => d.path.split('/').slice(0, -1).map((_, i, arr) => arr.slice(0, i + 1).join('/'))))]
    const savedOrder = data.treeOrder ?? {}
    const treeOrder: Record<string, number> = {}
    let nextOrder = Math.max(0, ...Object.values(savedOrder).filter((v) => Number.isFinite(v))) + 1000
    for (const doc of sorted) {
      const value = Number(savedOrder[doc.path])
      if (Number.isFinite(value)) {
        treeOrder[doc.path] = value
      } else {
        nextOrder += 1000
        treeOrder[doc.path] = nextOrder
      }
    }
    writeTreeOrder(treeOrder)
    localStorage.setItem('inkspire:seeded', '1')
    this.discardPending = true
    this.set({
      docs: sorted,
      folders,
      treeOrder,
      activeId: active?.id ?? null,
      savedAt: active?.updatedAt ?? 0,
      savedAtByDoc: Object.fromEntries(sorted.map((d) => [d.id, d.updatedAt])),
    })
    if (active) localStorage.setItem('inkspire:lastDoc', active.id)
    window.dispatchEvent(new CustomEvent('inkspire:vault-restored'))
    this.flash(`已恢复 ${docs.length} 篇文档${isTauri ? '并写回 vault' : ''}`, 'success')
  }

  async exportBackup() {
    // 备份不包含任何 API Key
    const settings = JSON.parse(JSON.stringify(this.state.settings))
    if (settings.ai) {
      settings.ai.apiKey = ''
      settings.ai.keys = {}
    }
    const data = { app: 'inkspire', version: 1, exportedAt: Date.now(), docs: this.state.docs, settings, treeOrder: this.state.treeOrder }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const name = `inkspire-backup-${new Date().toISOString().slice(0, 10)}.json`
    try {
      if (isTauri) {
        const path = await platform.saveExport(name, blob)
        this.flash(`已导出到 ${path.split('/').slice(-2).join('/')}`, 'success')
        return
      }
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = name
      a.click()
      URL.revokeObjectURL(a.href)
      this.flash('已导出备份', 'success')
    } catch (e: any) {
      this.flash(`导出备份失败：${e?.message ?? e}`, 'error')
    }
  }
}

/* ------------------------------- 种子文档 ------------------------------- */

const INITIAL_DOCS: { path: string; title: string; raw: string }[] = [
  { path: '项目介绍.md', title: '项目介绍', raw: introRaw },
  { path: '项目使用.md', title: '项目使用', raw: usageRaw },
  { path: 'Markdown 支持.md', title: 'Markdown 支持', raw: markdownRaw },
]

function makeInitialDoc(spec: { path: string; title: string; raw: string }): Document {
  const now = Date.now()
  const { fm } = parseFrontMatter(spec.raw)
  return {
    id: uid(),
    path: spec.path,
    title: spec.title,
    frontMatter: fm,
    content: spec.raw,
    createdAt: now,
    updatedAt: now,
    wordCount: countWords(spec.raw),
    preview: makePreview(spec.raw),
    favorite: false,
    versions: [],
  }
}

function seedDocuments(): Document[] {
  return INITIAL_DOCS.map(makeInitialDoc)
}


export const vault = new Vault()
