import { useCallback, useEffect, useRef, useState } from 'react'

interface Props {
  value: number
  min: number
  max: number
  step?: number
  onChange: (value: number) => void
  ariaLabel?: string
  format?: (value: number) => string
}

export function Slider({ value, min, max, step = 1, onChange, ariaLabel, format }: Props) {
  const trackRef = useRef<HTMLDivElement | null>(null)
  const [dragging, setDragging] = useState(false)

  const ratio = Math.min(1, Math.max(0, (value - min) / Math.max(1e-6, max - min)))

  const snap = useCallback(
    (raw: number) => {
      const stepped = Math.round((raw - min) / step) * step + min
      return Math.min(max, Math.max(min, Number(stepped.toFixed(4))))
    },
    [min, max, step],
  )

  const setFromClientX = useCallback(
    (clientX: number) => {
      const el = trackRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const p = (clientX - r.left) / Math.max(1, r.width)
      onChange(snap(min + p * (max - min)))
    },
    [min, max, onChange, snap],
  )

  useEffect(() => {
    if (!dragging) return
    const move = (e: PointerEvent) => setFromClientX(e.clientX)
    const up = () => setDragging(false)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [dragging, setFromClientX])

  return (
    <div
      className={`ui-slider${dragging ? ' dragging' : ''}`}
      role="slider"
      tabIndex={0}
      aria-label={ariaLabel}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
          e.preventDefault()
          onChange(snap(value - step))
        }
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
          e.preventDefault()
          onChange(snap(value + step))
        }
        if (e.key === 'Home') onChange(min)
        if (e.key === 'End') onChange(max)
      }}
    >
      <div
        className="ui-slider-track"
        ref={trackRef}
        onPointerDown={(e) => {
          e.preventDefault()
          setDragging(true)
          setFromClientX(e.clientX)
        }}
      >
        <div className="ui-slider-fill" style={{ width: `${ratio * 100}%` }} />
        <div className="ui-slider-thumb" style={{ left: `${ratio * 100}%` }} />
      </div>
      <span className="ui-slider-value">{format ? format(value) : value}</span>
    </div>
  )
}
