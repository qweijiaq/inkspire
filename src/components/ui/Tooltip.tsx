import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

interface Tip {
  text: string
  rect: DOMRect
}

/**
 * 全局轻提示：用 `data-tip` 代替原生 `title`（UI 规范 §7.2 / §7.4）。
 * 指针悬停延迟 320ms，键盘聚焦立即出现；点击、滚动、Esc 都会收起。
 */
export function useGlobalTooltip(): Tip | null {
  const [tip, setTip] = useState<Tip | null>(null)

  useEffect(() => {
    let timer = 0
    let current: HTMLElement | null = null

    const clear = () => {
      window.clearTimeout(timer)
      setTip(null)
    }
    const show = (el: HTMLElement, delay: number) => {
      const text = el.dataset.tip?.trim()
      if (!text) return
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setTip({ text, rect: el.getBoundingClientRect() }), delay)
    }
    const onOver = (event: PointerEvent) => {
      const el = (event.target as HTMLElement | null)?.closest?.('[data-tip]') as HTMLElement | null
      if (el === current) return
      current = el
      clear()
      if (el) show(el, 320)
    }
    const onOut = (event: PointerEvent) => {
      if (!current) return
      const to = event.relatedTarget as Node | null
      if (to && current.contains(to)) return
      current = null
      clear()
    }
    const onFocus = (event: FocusEvent) => {
      const el = (event.target as HTMLElement | null)?.closest?.('[data-tip]') as HTMLElement | null
      if (!el) return
      current = el
      clear()
      show(el, 80)
    }
    const onBlur = () => {
      current = null
      clear()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') clear()
    }

    document.addEventListener('pointerover', onOver)
    document.addEventListener('pointerout', onOut)
    document.addEventListener('focusin', onFocus)
    document.addEventListener('focusout', onBlur)
    document.addEventListener('pointerdown', clear, true)
    window.addEventListener('scroll', clear, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('pointerover', onOver)
      document.removeEventListener('pointerout', onOut)
      document.removeEventListener('focusin', onFocus)
      document.removeEventListener('focusout', onBlur)
      document.removeEventListener('pointerdown', clear, true)
      window.removeEventListener('scroll', clear, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  return tip
}

export function TooltipLayer({ tip }: { tip: Tip | null }) {
  if (!tip) return null
  const gap = 8
  const above = tip.rect.top > 64
  const top = above ? tip.rect.top - gap : tip.rect.bottom + gap
  const half = 150
  const left = Math.min(Math.max(tip.rect.left + tip.rect.width / 2, half), window.innerWidth - half)
  return createPortal(
    <div
      className={`ui-tooltip${above ? ' up' : ' down'}`}
      role="tooltip"
      style={{ left, top, transform: above ? 'translate(-50%, -100%)' : 'translate(-50%, 0)' }}
    >
      {tip.text}
    </div>,
    document.body,
  )
}
