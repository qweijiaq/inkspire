import type { FigureIssue, FigureSpec } from './figures'

export interface StoredPlanItem {
  section: string
  body: string
  spec: FigureSpec
  selected: boolean
  issues?: FigureIssue[]
}

const KEY = (docId: string) => `inkspire:figurePlan:${docId}`

/** 保存未插入的整篇提纲，关掉弹窗或切文档后还能继续 */
export function saveFigurePlan(docId: string, items: StoredPlanItem[]): void {
  try {
    localStorage.setItem(KEY(docId), JSON.stringify({ savedAt: Date.now(), items }))
  } catch {
    /* quota or private mode */
  }
}

export function loadFigurePlan(docId: string): StoredPlanItem[] | null {
  try {
    const raw = localStorage.getItem(KEY(docId))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed?.items) && parsed.items.length ? (parsed.items as StoredPlanItem[]) : null
  } catch {
    return null
  }
}

export function clearFigurePlan(docId: string): void {
  try {
    localStorage.removeItem(KEY(docId))
  } catch {
    /* ignore */
  }
}
