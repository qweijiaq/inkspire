import { useEffect, useRef, useState } from 'react'

interface Props {
  value: number
  min?: number
  max?: number
  step?: number
  onChange: (value: number) => void
  ariaLabel?: string
  suffix?: string
  precision?: number
}

export function NumberField({ value, min = -Infinity, max = Infinity, step = 1, onChange, ariaLabel, suffix, precision = 0 }: Props) {
  const [text, setText] = useState(String(value))
  const focused = useRef(false)

  useEffect(() => {
    if (!focused.current) setText(format(value))
  }, [value, precision])

  function format(v: number) {
    return precision > 0 ? v.toFixed(precision).replace(/0+$/, '').replace(/\.$/, '') : String(v)
  }

  const clamp = (v: number) => Math.min(max, Math.max(min, v))

  const commit = (raw: string) => {
    const parsed = Number(raw.replace(/[^\d.\-]/g, ''))
    if (!Number.isFinite(parsed) || raw.trim() === '') {
      setText(format(value))
      return
    }
    const next = clamp(Number(parsed.toFixed(precision)))
    onChange(next)
    setText(format(next))
  }

  const bump = (dir: 1 | -1) => {
    const next = clamp(Number((value + dir * step).toFixed(Math.max(2, precision))))
    onChange(next)
    setText(format(next))
  }

  return (
    <div className="ui-number">
      <button type="button" className="ui-number-btn" onClick={() => bump(-1)} aria-label="减少" tabIndex={-1}>
        −
      </button>
      <input
        type="text"
        inputMode={precision > 0 ? 'decimal' : 'numeric'}
        value={text}
        aria-label={ariaLabel}
        onFocus={() => (focused.current = true)}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => {
          focused.current = false
          commit(e.target.value)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.currentTarget.blur()
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault()
            bump(1)
          }
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            bump(-1)
          }
        }}
      />
      {suffix && <span className="ui-number-suffix">{suffix}</span>}
      <button type="button" className="ui-number-btn" onClick={() => bump(1)} aria-label="增加" tabIndex={-1}>
        +
      </button>
    </div>
  )
}
