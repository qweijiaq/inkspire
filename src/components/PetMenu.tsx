import type { PetGameApi } from '../lib/petGame'
import { Icon } from './ui/Icon'

interface Props {
  game: PetGameApi
  onPat: () => void
  onFeed: () => void
  onPlay: () => void
  onFocus: (minutes: number) => void
  onStopFocus: () => void
  onActivate: () => void
  onSettings: () => void
  onHide: () => void
  onClose: () => void
}

function mmss(ms: number) {
  const total = Math.ceil(ms / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

export function PetMenu({ game, onPat, onFeed, onPlay, onFocus, onStopFocus, onActivate, onSettings, onHide, onClose }: Props) {
  const { game: state, level, remaining } = game
  return (
    <div className="pet-menu" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      <div className="pet-menu-head">
        <b>墨墨 · Lv.{level}</b>
        <span>连续陪伴 {state.streak} 天</span>
        <button type="button" onClick={onClose} aria-label="关闭互动面板"><Icon name="close" size={14} /></button>
      </div>

      <div className="pet-menu-stats">
        <div>
          <span>亲密度</span>
          <i><em style={{ width: `${Math.min(100, (state.affection % 10) * 10 || 4)}%` }} /></i>
          <b>{state.affection}</b>
        </div>
        <div>
          <span>精力</span>
          <i><em className="energy" style={{ width: `${Math.min(100, state.energy)}%` }} /></i>
          <b>{state.energy}</b>
        </div>
      </div>

      <div className="pet-menu-focus">
        {remaining > 0 ? (
          <>
            <span>专注中 <b>{mmss(remaining)}</b></span>
            <button type="button" onClick={onStopFocus}>提前结束</button>
          </>
        ) : (
          <>
            <span>一起专注</span>
            <div>
              {[15, 25, 45].map((m) => (
                <button key={m} type="button" onClick={() => onFocus(m)}>{m} 分</button>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="pet-menu-actions">
        <button type="button" onClick={onPat}><b>摸摸</b><span>亲密度 +1</span></button>
        <button type="button" onClick={onFeed}><b>喂墨滴</b><span>精力 +18</span></button>
        <button type="button" onClick={onPlay}><b>击掌</b><span>亲密度 +2</span></button>
      </div>

      <div className="pet-menu-foot">
        <button type="button" onClick={onActivate}>主窗</button>
        <button type="button" onClick={onSettings}>设置</button>
        <button type="button" onClick={onHide}>隐藏</button>
      </div>
    </div>
  )
}
