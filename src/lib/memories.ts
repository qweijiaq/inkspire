import { useEffect, useState } from 'react'

export interface MemoryFact {
  id: string
  text: string
  createdAt: number
}

const KEY = 'inkspire:memories'

export function loadMemories(): MemoryFact[] {
  try {
    const raw = localStorage.getItem(KEY)
    const parsed = raw ? (JSON.parse(raw) as MemoryFact[]) : []
    return Array.isArray(parsed) ? parsed.filter((m) => m && m.text) : []
  } catch {
    return []
  }
}

function save(next: MemoryFact[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(next.slice(0, 50)))
    window.dispatchEvent(new CustomEvent('inkspire:memories'))
    return true
  } catch {
    return false
  }
}

export function addMemory(text: string) {
  const clean = text.trim()
  if (!clean) return null
  const fact: MemoryFact = { id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`, text: clean.slice(0, 300), createdAt: Date.now() }
  if (!save([fact, ...loadMemories()])) return null
  return fact
}

export function removeMemory(id: string) {
  return save(loadMemories().filter((m) => m.id !== id))
}

export function useMemories() {
  const [memories, setMemories] = useState<MemoryFact[]>(() => loadMemories())
  useEffect(() => {
    const sync = () => setMemories(loadMemories())
    window.addEventListener('inkspire:memories', sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener('inkspire:memories', sync)
      window.removeEventListener('storage', sync)
    }
  }, [])
  return memories
}
