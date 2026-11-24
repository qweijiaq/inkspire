import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAnchoredPopover, useOutsideClose } from './popover'
import { Icon } from './Icon'

interface Props {
  value: string
  onChange: (value: string) => void
  options: string[]
  placeholder?: string
  ariaLabel?: string
}

export function SuggestionInput({ value, onChange, options, placeholder, ariaLabel }: Props) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [filter, setFilter] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const { anchorRef, rect } = useAnchoredPopover(open)
  const popRef = useRef<HTMLDivElement | null>(null)
  useOutsideClose(open, [wrapRef, popRef], () => setOpen(false))

  const q = filter.trim().toLowerCase()
  const filtered = (q ? options.filter((o) => o.toLowerCase().includes(q)) : options).slice(0, 60)

  useEffect(() => setActive(0), [q, open])

  const commit = (index: number) => {
    const pick = filtered[index]
    if (!pick) return
    onChange(pick)
    setFilter('')
    setOpen(false)
    inputRef.current?.focus()
  }

  return (
    <div className="ui-suggest" ref={(el) => { wrapRef.current = el; anchorRef.current = el }}>
      <input
        ref={inputRef}
        type="text"
        value={value}
        aria-label={ariaLabel}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value)
          setFilter(e.target.value)
          setOpen(true)
        }}
        onFocus={() => {
          setFilter('')
          setOpen(true)
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setOpen(true)
            setActive((i) => Math.min(filtered.length - 1, i + 1))
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((i) => Math.max(0, i - 1))
          }
          if (e.key === 'Enter' && open && filtered.length) {
            e.preventDefault()
            commit(active)
          }
          if (e.key === 'Escape') {
            e.stopPropagation()
            setFilter('')
            setOpen(false)
          }
        }}
      />
      <button type="button" className="ui-suggest-caret" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => setOpen((v) => !v)} aria-label="展开模型列表">
        ▾
      </button>
      {open &&
        filtered.length > 0 &&
        rect &&
        createPortal(
          <div className="ui-popover ui-select-popover" ref={popRef} style={{ left: rect.left, top: rect.top, width: rect.width, maxHeight: rect.maxHeight, transform: rect.placement === 'up' ? 'translateY(-100%)' : undefined }}>
            {filtered.map((opt, i) => (
              <button
                type="button"
                key={opt}
                className={`ui-option${i === active ? ' active' : ''}${opt === value ? ' selected' : ''}`}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => commit(i)}
              >
                <span>{opt}</span>
                {opt === value && <i className="ui-option-check"><Icon name="check" size={12} /></i>}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  )
}
