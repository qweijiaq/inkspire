export interface AiEdit {
  id: string
  docId: string
  at: number
  label: string
  before: string
  after: string
}

const KEY = 'inkspire:aiEdits'
const MAX_TOTAL = 60
const MAX_PER_DOC = 20
const MAX_CHARS = 400_000
const MAX_BYTES = 3_500_000

function read(): AiEdit[] {
  try {
    const raw = localStorage.getItem(KEY)
    const rows = raw ? JSON.parse(raw) : []
    return Array.isArray(rows) ? rows.filter((r) => r && r.id && r.docId && typeof r.before === 'string' && typeof r.after === 'string') : []
  } catch {
    return []
  }
}

function write(rows: AiEdit[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(rows))
  } catch {
    /* quota */
  }
}

/** 记录一次 AI 写入前后的完整文本，供一键撤销 */
export function recordAiEdit(docId: string, label: string, before: string, after: string): void {
  if (before === after) return
  if (before.length > MAX_CHARS || after.length > MAX_CHARS) return
  const entry: AiEdit = {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    docId,
    at: Date.now(),
    label,
    before,
    after,
  }
  let rows = [entry, ...read()]
  const perDoc = new Map<string, number>()
  rows = rows.filter((row) => {
    const n = (perDoc.get(row.docId) ?? 0) + 1
    perDoc.set(row.docId, n)
    return n <= MAX_PER_DOC
  }).slice(0, MAX_TOTAL)
  // 控制本机存储：从最旧的记录开始丢，保留最近的操作
  let bytes = JSON.stringify(rows).length
  while (rows.length > 1 && bytes > MAX_BYTES) {
    rows.pop()
    bytes = JSON.stringify(rows).length
  }
  write(rows)
}

export function latestAiEdit(docId: string): AiEdit | null {
  return read().find((row) => row.docId === docId) ?? null
}

export function listAiEdits(docId: string): AiEdit[] {
  return read().filter((row) => row.docId === docId)
}

export function removeAiEdit(id: string): void {
  write(read().filter((row) => row.id !== id))
}

export function findAiEdit(id: string): AiEdit | null {
  return read().find((row) => row.id === id) ?? null
}

/** 回放到某次写入之前时，比它更晚的 AI 写入也一并失效 */
export function removeAiEditsFrom(docId: string, at: number): void {
  write(read().filter((row) => !(row.docId === docId && row.at >= at)))
}
