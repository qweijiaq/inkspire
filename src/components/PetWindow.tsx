import { useEffect, useRef, useState } from 'react'
import { Momo, PET_LINES } from './Momo'
import { platform } from '../lib/platform'
import type { Mood } from '../types'
import { PetMenu } from './PetMenu'
import { usePetGame } from '../lib/petGame'
import { TooltipLayer, useGlobalTooltip } from './ui/Tooltip'
import { Icon } from './ui/Icon'

/** 独立透明桌宠窗口（Tauri 多窗口） */
export function PetWindow() {
  const tip = useGlobalTooltip()
  const [mood, setMood] = useState<Mood>('idle')
  const [line, setLine] = useState<string | null>(null)
  const [stats, setStats] = useState<number | null>(null)
  const [menu, setMenu] = useState(false)
  const petGame = usePetGame()
  const bubbleTimer = useRef(0)
  const idleTimer = useRef(0)
  const press = useRef<{ x: number; y: number; moved: boolean } | null>(null)

  const resetIdle = () => {
    window.clearTimeout(idleTimer.current)
    idleTimer.current = window.setTimeout(() => {
      setMood('sleepy')
      setLine('Zzz… 写了这么久，歇一会儿')
      window.clearTimeout(bubbleTimer.current)
      bubbleTimer.current = window.setTimeout(() => setLine(null), 2400)
    }, 5 * 60_000)
  }

  useEffect(() => {
    document.documentElement.classList.add('pet-window')
    resetIdle()
    return () => {
      document.documentElement.classList.remove('pet-window')
      window.clearTimeout(idleTimer.current)
      window.clearTimeout(bubbleTimer.current)
    }
  }, [])

  useEffect(() => {
    if (!petGame.game.completedAt) return
    setMood('happy')
    setLine('专注完成，起来伸个懒腰 ✦')
    window.clearTimeout(bubbleTimer.current)
    bubbleTimer.current = window.setTimeout(() => setLine(null), 3200)
  }, [petGame.game.completedAt])

  useEffect(() => {
    const offs: ((() => void) | null)[] = []
    void platform
      .listen<{ mood: Mood; line?: string | null }>('inkspire:pet:state', (p) => {
        setMood(p.mood)
        resetIdle()
        if (p.line) {
          setLine(p.line)
          window.clearTimeout(bubbleTimer.current)
          bubbleTimer.current = window.setTimeout(() => setLine(null), 2400)
        }
      })
      .then((u) => offs.push(u))
    void platform
      .listen<{ words: number }>('inkspire:pet:stats', (p) => setStats(p.words))
      .then((u) => offs.push(u))
    return () => offs.forEach((u) => u?.())
  }, [])

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return
    press.current = { x: e.clientX, y: e.clientY, moved: false }
    const move = (ev: PointerEvent) => {
      if (!press.current) return
      if (Math.abs(ev.clientX - press.current.x) > 4 || Math.abs(ev.clientY - press.current.y) > 4) {
        press.current.moved = true
        window.removeEventListener('pointermove', move)
        void platform.startWindowDrag()
      }
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const onClick = () => {
    if (press.current?.moved) {
      press.current = null
      return
    }
    press.current = null
    resetIdle()
    const pool = PET_LINES[mood] ?? PET_LINES.idle
    const pick = pool[Math.floor(Math.random() * pool.length)]
    setMood(pick.mood)
    setLine(pick.line)
    window.clearTimeout(bubbleTimer.current)
    bubbleTimer.current = window.setTimeout(() => setLine(null), 2400)
  }

  const act = (action: string) => {
    setMenu(false)
    void platform.emit('inkspire:pet:action', { action })
  }

  return (
    <div
      className="pet-window-root"
      onPointerDown={onPointerDown}
      onClick={onClick}
      onPointerMove={() => resetIdle()}
      onDoubleClick={() => void platform.petActivate()}
      onContextMenu={(e) => {
        e.preventDefault()
        setMenu((v) => !v)
      }}
    >
      {line && <div className="pet-bubble">{line}</div>}

      {menu && (
        <PetMenu
          game={petGame}
          onClose={() => setMenu(false)}
          onPat={() => { petGame.pat(); setMood('happy'); setLine('再摸一下…'); resetIdle() }}
          onFeed={() => { petGame.feed(); setMood('happy'); setLine('墨滴最好喝了！'); resetIdle() }}
          onPlay={() => { petGame.play(); setMood('surprised'); setLine('嘿！接住！'); resetIdle() }}
          onFocus={(m) => { petGame.startFocus(m); setMood('thinking'); setLine(`专注 ${m} 分钟，开始！`); resetIdle() }}
          onStopFocus={() => { petGame.stopFocus(); setMood('idle'); setLine('好，先歇会儿'); resetIdle() }}
          onActivate={() => { setMenu(false); void platform.petActivate() }}
          onSettings={() => { setMenu(false); act('settings') }}
          onHide={() => { setMenu(false); act('hide-pet') }}
        />
      )}

      <div className={`pet-actions${menu ? ' open' : ''}`}>
        <button data-tip="互动" aria-label="互动" onPointerDown={(e) => e.stopPropagation()} onClick={() => setMenu((v) => !v)}>
          <Icon name="heart" size={15} />
        </button>
        <button data-tip="新建速记" aria-label="新建速记" onPointerDown={(e) => e.stopPropagation()} onClick={() => act('new-note')}>
          <Icon name="edit" size={15} />
        </button>
        <button data-tip="唤出主窗" aria-label="唤出主窗" onPointerDown={(e) => e.stopPropagation()} onClick={() => act('focus')}>
          <Icon name="maximize" size={15} />
        </button>
        <button data-tip="打开设置" aria-label="打开设置" onPointerDown={(e) => e.stopPropagation()} onClick={() => act('settings')}>
          <Icon name="settings" size={15} />
        </button>
        <button data-tip="隐藏墨墨" aria-label="隐藏墨墨" onPointerDown={(e) => e.stopPropagation()} onClick={() => act('hide-pet')}>
          <Icon name="close" size={15} />
        </button>
      </div>

      <div className="pet-stage" data-mood={mood}>
        <div className="pet-shadow" />
        <Momo mood={mood} className="pet-svg" />
      </div>
      {petGame.remaining > 0 ? (
        <div className="pet-stats">专注 {Math.floor(petGame.remaining / 60000)}:{String(Math.ceil(petGame.remaining / 1000) % 60).padStart(2, '0')}</div>
      ) : stats != null ? (
        <div className="pet-stats">今天 {stats.toLocaleString()} 字 · Lv.{petGame.level}</div>
      ) : (
        <div className="pet-tag">右键互动 · 双击叫主窗</div>
      )}
      <TooltipLayer tip={tip} />
    </div>
  )
}
