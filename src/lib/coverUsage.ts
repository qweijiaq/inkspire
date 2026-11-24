const KEY = 'inkspire:coverUsage'
const DOC_LIMIT = 3
const DAY_LIMIT = 20

interface Usage {
  day: string
  total: number
  docs: Record<string, number>
}

function today(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function read(): Usage {
  try {
    const raw = localStorage.getItem(KEY)
    const parsed = raw ? JSON.parse(raw) : null
    if (parsed && parsed.day === today()) return { day: parsed.day, total: Number(parsed.total) || 0, docs: parsed.docs ?? {} }
  } catch {
    /* ignore */
  }
  return { day: today(), total: 0, docs: {} }
}

export function coverBudget(docId: string): { ok: boolean; remaining: number; dayRemaining: number; reason?: string } {
  const usage = read()
  const used = usage.docs[docId] ?? 0
  if (used >= DOC_LIMIT) return { ok: false, remaining: 0, dayRemaining: Math.max(0, DAY_LIMIT - usage.total), reason: `这篇文档今天已生成 ${DOC_LIMIT} 张封面` }
  if (usage.total >= DAY_LIMIT) return { ok: false, remaining: DOC_LIMIT - used, dayRemaining: 0, reason: `今天全站封面额度 ${DAY_LIMIT} 张已用完` }
  return { ok: true, remaining: DOC_LIMIT - used, dayRemaining: DAY_LIMIT - usage.total }
}

export function recordCover(docId: string): void {
  const usage = read()
  usage.total += 1
  usage.docs[docId] = (usage.docs[docId] ?? 0) + 1
  try {
    localStorage.setItem(KEY, JSON.stringify(usage))
  } catch {
    /* quota */
  }
}
