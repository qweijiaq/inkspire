import { useEffect, useState } from 'react'

export interface LearningCard {
  id: string
  docId: string
  docTitle: string
  question: string
  answer: string
  source: string
  createdAt: number
  due: number
  interval: number
  reviews: number
  remembered: number
}

export interface LearningState {
  cards: LearningCard[]
  streak: number
  lastDay: string
  reviews: number
}

const KEY = 'inkspire:learning'
const INTERVALS = [1, 3, 7, 14, 30]

function today() {
  return new Date().toISOString().slice(0, 10)
}

function defaults(): LearningState {
  return { cards: [], streak: 0, lastDay: '', reviews: 0 }
}

function read(): LearningState {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return defaults()
    const parsed = JSON.parse(raw) as Partial<LearningState>
    return { ...defaults(), ...parsed, cards: Array.isArray(parsed.cards) ? parsed.cards : [] }
  } catch {
    return defaults()
  }
}

function write(state: LearningState) {
  localStorage.setItem(KEY, JSON.stringify(state))
  window.dispatchEvent(new CustomEvent('inkspire:learning'))
}

function touchStudy(state: LearningState): LearningState {
  const day = today()
  if (state.lastDay === day) return state
  return { ...state, lastDay: day, streak: state.streak + 1 }
}

export function loadLearning(): LearningState {
  return read()
}

export function recordStudy() {
  const state = read()
  write(touchStudy(state))
}

export function addCard(input: { docId: string; docTitle: string; question: string; answer: string; source: string }) {
  const state = read()
  const card: LearningCard = {
    id: `card-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    docId: input.docId,
    docTitle: input.docTitle,
    question: input.question.trim() || '这段话的关键点是什么？',
    answer: input.answer.trim(),
    source: input.source.slice(0, 160),
    createdAt: Date.now(),
    due: Date.now(),
    interval: 0,
    reviews: 0,
    remembered: 0,
  }
  if (!card.answer) return null
  write(touchStudy({ ...state, cards: [card, ...state.cards] }))
  return card
}

export function reviewCard(id: string, remembered: boolean) {
  const state = read()
  const cards = state.cards.map((card) => {
    if (card.id !== id) return card
    const interval = remembered ? Math.min(INTERVALS.length - 1, card.interval + 1) : 0
    const days = remembered ? INTERVALS[interval] : 0
    return {
      ...card,
      interval,
      reviews: card.reviews + 1,
      remembered: card.remembered + (remembered ? 1 : 0),
      due: Date.now() + (remembered ? days * 86_400_000 : 10 * 60_000),
    }
  })
  write(touchStudy({ ...state, cards, reviews: state.reviews + 1 }))
}

export function removeCard(id: string) {
  const state = read()
  write({ ...state, cards: state.cards.filter((c) => c.id !== id) })
}

export function dueCards(cards: LearningCard[]) {
  const now = Date.now()
  return cards.filter((c) => c.due <= now).sort((a, b) => a.due - b.due)
}

export function staleCards(cards: LearningCard[], days = 14) {
  const cutoff = Date.now() - days * 86_400_000
  return cards.filter((c) => c.due < cutoff).sort((a, b) => a.due - b.due)
}

export function useLearning() {
  const [state, setState] = useState<LearningState>(() => read())
  useEffect(() => {
    const sync = () => setState(read())
    window.addEventListener('inkspire:learning', sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener('inkspire:learning', sync)
      window.removeEventListener('storage', sync)
    }
  }, [])
  return state
}
