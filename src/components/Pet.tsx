import { useEffect, useRef, useState } from 'react'
import { vault, useVault } from '../store'
import { Momo, PET_LINES } from './Momo'
import { PetMenu } from './PetMenu'
import { usePetGame } from '../lib/petGame'

export function Pet() {
  const state = useVault()
  const [pos, setPos] = useState<{ x: number; y: number } | null>(() => {
    try {
      const raw = localStorage.getItem('inkspire:petPos')
      return raw ? JSON.parse(raw) : null
    } catch {
      return null
    }
  })
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef<{ dx: number; dy: number; moved: boolean } | null>(null)
  const [bubble, setBubble] = useState<string | null>(null)
  const [menu, setMenu] = useState(false)
  const petGame = usePetGame()
  const bubbleTimer = useRef(0)
  const elRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (state.petLine) {
      setBubble(state.petLine)
      window.clearTimeout(bubbleTimer.current)
      bubbleTimer.current = window.setTimeout(() => setBubble(null), 2400)
    }
  }, [state.petLine, state.mood])

  useEffect(() => () => window.clearTimeout(bubbleTimer.current), [])

  useEffect(() => {
    if (!petGame.game.completedAt) return
    vault.pet('happy', '专注完成，起来伸个懒腰 ✦', 3200)
  }, [petGame.game.completedAt])

  const mmss = (ms: number) => {
    const total = Math.ceil(ms / 1000)
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
  }

  if (!state.settings.showPet) return null

  const onPointerDown = (e: React.PointerEvent) => {
    const el = elRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    dragRef.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top, moved: false }
    setDragging(true)
    el.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current || !dragging) return
    const x = Math.max(8, Math.min(window.innerWidth - 130, e.clientX - dragRef.current.dx))
    const y = Math.max(70, Math.min(window.innerHeight - 150, e.clientY - dragRef.current.dy))
    if (Math.abs(x - (pos?.x ?? 0)) > 3 || Math.abs(y - (pos?.y ?? 0)) > 3) dragRef.current.moved = true
    setPos({ x, y })
  }

  const onPointerUp = (e: React.PointerEvent) => {
    setDragging(false)
    if (dragRef.current && !dragRef.current.moved) {
      const pool = PET_LINES[state.mood] ?? PET_LINES.idle
      const pick = pool[Math.floor(Math.random() * pool.length)]
      vault.pet(pick.mood, pick.line, 2600)
    }
    dragRef.current = null
    elRef.current?.releasePointerCapture(e.pointerId)
    if (pos) localStorage.setItem('inkspire:petPos', JSON.stringify(pos))
  }

  const style = pos ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' } : undefined

  return (
    <div
      ref={elRef}
      className={`pet${dragging ? ' dragging' : ''}`}
      style={style}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      data-tip="点我有惊喜 · 右键互动 · 拖走也可以"
      onContextMenu={(e) => {
        e.preventDefault()
        setMenu((v) => !v)
      }}
    >
      {bubble && <div className="pet-bubble">{bubble}</div>}
      <div className="pet-stage" data-mood={state.mood}>
        <div className="pet-shadow" />
        <Momo mood={state.mood} className="pet-svg" />
      </div>
      {menu && (
        <PetMenu
          game={petGame}
          onClose={() => setMenu(false)}
          onPat={() => { petGame.pat(); vault.pet('happy', '再摸一下…', 2200) }}
          onFeed={() => { petGame.feed(); vault.pet('happy', '墨滴最好喝了！', 2200) }}
          onPlay={() => { petGame.play(); vault.pet('surprised', '嘿！接住！', 2200) }}
          onFocus={(m) => { petGame.startFocus(m); vault.pet('thinking', `专注 ${m} 分钟，开始！`, 2600) }}
          onStopFocus={() => { petGame.stopFocus(); vault.pet('idle', '好，先歇会儿', 2000) }}
          onActivate={() => { setMenu(false); document.querySelector<HTMLElement>('.cm-content')?.focus() }}
          onSettings={() => { setMenu(false); vault.setModal({ settingsOpen: true }) }}
          onHide={() => { setMenu(false); void vault.updateSettings({ showPet: false }) }}
        />
      )}
      <div className="pet-tag">
        {petGame.remaining > 0 ? `专注 ${mmss(petGame.remaining)}` : `Lv.${petGame.level} · 连续 ${petGame.game.streak} 天`}
      </div>
    </div>
  )
}
