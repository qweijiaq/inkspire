/** Inkspire 数据契约（对齐《数据模型与Schema》v1.0，浏览器本地实现） */

export type DocStatus = 'draft' | 'in-progress' | 'done' | 'archived'

export interface FrontMatter {
  id?: string
  title?: string
  tags: string[]
  aliases: string[]
  date?: string
  status?: DocStatus
  created?: string
  updated?: string
  author?: string
  source?: { importer: string; originalPath: string; importedAt: number }
  extra: Record<string, unknown>
}

export interface DocumentVersion {
  id: string
  at: number
  content: string
  reason: 'autosave' | 'manual' | 'import' | 'restore'
}

export interface Document {
  id: string
  /** vault 相对路径，POSIX，唯一 */
  path: string
  title: string
  frontMatter: FrontMatter
  content: string
  createdAt: number
  updatedAt: number
  wordCount: number
  preview: string
  favorite: boolean
  versions: DocumentVersion[]
  /** 仅导入来源文档 */
  importMeta?: ImportedMeta
}

export interface ImportedMeta {
  importer: string
  originalName: string
  quality: number
  chapters: number
  tier: string
}

/** 桌宠唯一合法六态（UI 规范 §8.6；旧名 typing/saved 已废弃） */
export type Mood = 'idle' | 'writing' | 'thinking' | 'happy' | 'surprised' | 'sleepy'

export interface Heading {
  level: number
  text: string
  /** 源文本中的行号（0-based） */
  line: number
  offset: number
}

export interface WikiLink {
  raw: string
  target: string
  alias?: string
  heading?: string
  offset: number
  resolvedTo?: string
}

export interface TagInfo {
  tag: string
  count: number
  docs: string[]
}

export interface SearchHit {
  docId: string
  line: number
  text: string
  start: number
  length: number
  score: number
}

export interface ContextSource {
  id: string
  title: string
  line: number
  excerpt: string
  score: number
}

export interface SearchResult {
  docId: string
  title: string
  path: string
  hits: SearchHit[]
}

/* ---------------- 导入 ---------------- */

export type QualityTier = 'A' | 'B' | 'C' | 'D'

export interface Diagnostic {
  code: string
  severity: 'low' | 'medium' | 'high'
  message: string
}

export interface ChapterDraft {
  title: string
  level: number
  markdown: string
}

export interface ImportResult {
  /** 源文件名 */
  fileName: string
  /** 源文件自带的 Front Matter（Markdown 导入时保留） */
  frontMatter?: FrontMatter
  importer: string
  tier: QualityTier
  markdown: string
  chapters: ChapterDraft[]
  assets: { name: string; dataUrl: string }[]
  diagnostics: Diagnostic[]
  quality: {
    overall: number
    scores: {
      textExtraction: number
      structure: number
      chapterSplit: number
      tables: number
      images: number
      formulas: number
    }
  }
  stats: {
    characters: number
    paragraphs: number
    headings: number
    tables: number
    images: number
    pageCount?: number
  }
  needsConfirmation: boolean
  originalText: string
}

export interface ImportJob {
  id: string
  fileName: string
  fileSize: number
  status: 'detected' | 'parsing' | 'validating' | 'ready' | 'committed' | 'failed'
  progress: number
  result?: ImportResult
  error?: string
}

/* ---------------- 设置 ---------------- */

export type ProviderId =
  | 'demo'
  | 'anthropic'
  | 'openai'
  | 'deepseek'
  | 'zhipu'
  | 'moonshot'
  | 'alibaba'
  | 'openrouter'
  | 'opencode'
  | 'opencode-go'
  | 'opendesign'
  | 'ollama'
  | 'lmstudio'

export interface AISettings {
  provider: ProviderId
  baseUrl: string
  apiKey: string
  /** 每个服务商各自记住 Key，切换 provider 不串号 */
  keys: Record<string, string>
  model: string
  /** 语义检索用的 embedding 模型；留空则按服务商默认 */
  embeddingModel?: string
  /** 封面生图模型；留空则按服务商默认 */
  imageModel?: string
  temperature: number
  maxTokens: number
  /** 单次请求的上下文字数预算 */
  contextChars: number
  /** 每日字符预算（输入+输出）；0 表示不限制 */
  dailyCharBudget?: number
  enabled: boolean
}

export interface SourceRef {
  docId: string
  title: string
  line: number
  excerpt: string
}

export interface QiniuSettings {
  enabled: boolean
  accessKey: string
  bucket: string
  domain: string
  prefix: string
  zone: string
  /** SecretKey 存钥匙串；这里只标记是否已保存 */
  secretSet?: boolean
}

export interface AppSettings {
  /** 桌面版 vault 根目录；空字符串表示默认 ~/Documents/Inkspire */
  vaultPath?: string
  persona?: Persona
  theme: 'paper' | 'night'
  fontSize: number
  lineWidth: number
  fontFamily: 'sans' | 'serif' | 'mono'
  sourceMode: boolean
  showPet: boolean
  petLines: boolean
  typewriter: boolean
  focusMode: boolean
  autosaveMs: number
  ai: AISettings
  qiniu: QiniuSettings
  /** 隐私模式：AI 只允许本地/离线服务商，请求不出机 */
  privacyLocalOnly?: boolean
  sidebarTab: SidebarTab
}

export type Persona = 'gentle' | 'curious' | 'strict' | 'sassy'

export type SidebarTab = 'files' | 'search' | 'tags' | 'links' | 'learn' | 'ai'

export interface AISuggestion {
  id: string
  mode: 'continue' | 'rewrite' | 'summarize' | 'translate' | 'custom'
  title: string
  text: string
  original?: string
  streaming: boolean
  error?: string
  range?: { from: number; to: number }
  sources?: SourceRef[]
}
