import { useEffect, useState } from 'react'

export interface ReadingSpot {
  docId: string
  title: string
  line: number
  at: number
  section?: string
  sectionIndex?: number
  sectionsTotal?: number
  seconds?: number
}

const KEY = 'inkspire:reading'

export function loadReading(): ReadingSpot[] {
  try {
    const raw = localStorage.getItem(KEY)
    const parsed = raw ? (JSON.parse(raw) as ReadingSpot[]) : []
    return Array.isArray(parsed) ? parsed.filter((x) => x && x.docId) : []
  } catch {
    return []
  }
}

function save(next: ReadingSpot[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(next.slice(0, 30)))
    window.dispatchEvent(new CustomEvent('inkspire:reading'))
    return true
  } catch {
    return false
  }
}

export function saveReading(
  docId: string,
  title: string,
  line: number,
  extra: { section?: string; sectionIndex?: number; sectionsTotal?: number } = {},
) {
  const list = loadReading()
  const old = list.find((x) => x.docId === docId)
  const next = [{ docId, title, line, at: Date.now(), seconds: old?.seconds ?? 0, ...extra }, ...list.filter((x) => x.docId !== docId)]
  return save(next)
}

export function addReadingSeconds(docId: string, title: string, seconds: number) {
  const list = loadReading()
  const old = list.find((x) => x.docId === docId)
  const next = old
    ? [{ ...old, title, seconds: (old.seconds ?? 0) + seconds }, ...list.filter((x) => x.docId !== docId)]
    : [{ docId, title, line: 1, at: Date.now(), seconds }, ...list]
  return save(next)
}

export function getReading(docId: string): ReadingSpot | null {
  return loadReading().find((x) => x.docId === docId) ?? null
}

export function useReading() {
  const [state, setState] = useState<ReadingSpot[]>(() => loadReading())
  useEffect(() => {
    const sync = () => setState(loadReading())
    window.addEventListener('inkspire:reading', sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener('inkspire:reading', sync)
      window.removeEventListener('storage', sync)
    }
  }, [])
  return state
}

export function readingAgo(at: number) {
  const min = Math.floor((Date.now() - at) / 60_000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} 小时前`
  return `${Math.floor(hr / 24)} 天前`
}
