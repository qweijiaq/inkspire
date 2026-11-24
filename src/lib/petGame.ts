import { useEffect, useState } from 'react'
import { recordStudy } from './learning'

export interface PetGameState {
  affection: number
  energy: number
  streak: number
  lastDay: string
  pats: number
  focusUntil: number
  focusMinutes: number
  completedAt: number
}

const KEY = 'inkspire:petGame'

function today() {
  const d = new Date()
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

function yesterday() {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

function defaults(): PetGameState {
  return { affection: 0, energy: 72, streak: 0, lastDay: '', pats: 0, focusUntil: 0, focusMinutes: 25, completedAt: 0 }
}

export function loadPetGame(): PetGameState {
  try {
    const raw = localStorage.getItem(KEY)
    const parsed = raw ? (JSON.parse(raw) as Partial<PetGameState>) : {}
    return { ...defaults(), ...parsed }
  } catch {
    return defaults()
  }
}

function save(next: PetGameState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* ignore */
  }
}

function withDaily(state: PetGameState): PetGameState {
  const day = today()
  if (state.lastDay === day) return state
  const next = { ...state, lastDay: day, energy: Math.min(100, state.energy + 24) }
  if (state.lastDay === yesterday()) next.streak = state.streak + 1
  else if (state.lastDay) next.streak = 1
  else next.streak = 1
  return next
}

export function usePetGame() {
  const [game, setGame] = useState<PetGameState>(() => withDaily(loadPetGame()))
  const [remaining, setRemaining] = useState(0)

  useEffect(() => {
    const next = withDaily(loadPetGame())
    save(next)
    setGame(next)
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) setGame(loadPetGame())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  useEffect(() => {
    const tick = () => {
      const left = game.focusUntil ? Math.max(0, game.focusUntil - Date.now()) : 0
      setRemaining(left)
      if (game.focusUntil && left <= 0) {
        const next = { ...game, focusUntil: 0, completedAt: Date.now(), affection: game.affection + 3 }
        save(next)
        setGame(next)
        recordStudy()
      }
    }
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [game.focusUntil, game.affection])

  const mutate = (fn: (prev: PetGameState) => PetGameState) => {
    setGame((prev) => {
      const next = fn(prev)
      save(next)
      return next
    })
  }

  const pat = () =>
    mutate((p) => ({ ...p, pats: p.pats + 1, affection: p.affection + 1, energy: Math.max(0, p.energy - 1) }))
  const feed = () =>
    mutate((p) => ({ ...p, affection: p.affection + 1, energy: Math.min(100, p.energy + 18) }))
  const play = () =>
    mutate((p) => ({ ...p, affection: p.affection + 2, energy: Math.max(0, p.energy - 8) }))
  const startFocus = (minutes: number) =>
    mutate((p) => ({
      ...p,
      focusMinutes: minutes,
      focusUntil: Date.now() + minutes * 60_000,
      energy: Math.max(0, p.energy - 3),
    }))
  const stopFocus = () => mutate((p) => ({ ...p, focusUntil: 0 }))

  return {
    game,
    remaining,
    level: Math.floor(game.affection / 10) + 1,
    pat,
    feed,
    play,
    startFocus,
    stopFocus,
  }
}

export type PetGameApi = ReturnType<typeof usePetGame>
