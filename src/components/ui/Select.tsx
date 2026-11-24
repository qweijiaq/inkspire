import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAnchoredPopover, useOutsideClose } from './popover'
import { Icon } from './Icon'

export interface SelectOption {
  value: string
  label: string
  hint?: string
}

interface Props {
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  ariaLabel?: string
}

export function Select({ value, options, onChange, placeholder = '请选择', disabled, ariaLabel }: Props) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const { anchorRef, rect } = useAnchoredPopover(open)
  const popRef = useRef<HTMLDivElement | null>(null)
  const listId = useId()
  useOutsideClose(open, [anchorRef, popRef], () => setOpen(false))

  const current = options.find((o) => o.value === value)

  useEffect(() => {
    if (open) {
      const idx = Math.max(0, options.findIndex((o) => o.value === value))
      setActive(idx)
    }
  }, [open, options, value])

  const commit = (index: number) => {
    const opt = options[index]
    if (!opt) return
    onChange(opt.value)
    setOpen(false)
  }

  return (
    <div className={`ui-select${disabled ? ' disabled' : ''}`} ref={anchorRef}>
      <button
        type="button"
        className={`ui-select-trigger${open ? ' open' : ''}`}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
            e.preventDefault()
            if (!open) {
              setOpen(true)
              return
            }
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              commit(active)
              return
            }
            setActive((i) => (e.key === 'ArrowDown' ? Math.min(options.length - 1, i + 1) : Math.max(0, i - 1)))
          }
          if (e.key === 'Escape' && open) {
            e.preventDefault()
            e.stopPropagation()
            setOpen(false)
          }
        }}
      >
        <span className={current ? '' : 'placeholder'}>{current?.label ?? placeholder}</span>
        <span className="ui-select-caret"><Icon name="chevronDown" size={13} /></span>
      </button>

      {open &&
        rect &&
        createPortal(
          <div
            className="ui-popover ui-select-popover"
            role="listbox"
            id={listId}
            ref={popRef}
            style={{ left: rect.left, top: rect.top, width: rect.width, maxHeight: rect.maxHeight, transform: rect.placement === 'up' ? 'translateY(-100%)' : undefined }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setActive((i) => Math.min(options.length - 1, i + 1))
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault()
                setActive((i) => Math.max(0, i - 1))
              }
              if (e.key === 'Enter') {
                e.preventDefault()
                commit(active)
              }
              if (e.key === 'Escape') {
                e.preventDefault()
                e.stopPropagation()
                setOpen(false)
              }
            }}
          >
            {options.map((o, i) => (
              <button
                type="button"
                key={o.value}
                role="option"
                aria-selected={o.value === value}
                className={`ui-option${o.value === value ? ' selected' : ''}${i === active ? ' active' : ''}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => commit(i)}
              >
                <span>{o.label}</span>
                {o.hint && <em>{o.hint}</em>}
                {o.value === value && <i className="ui-option-check"><Icon name="check" size={12} /></i>}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  )
}
