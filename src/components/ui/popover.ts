import { useEffect, useLayoutEffect, useRef, useState } from 'react'

/** 锚定弹出层：portal 定位，避免被 modal 的滚动容器裁切 */
export function useAnchoredPopover(open: boolean, opts: { minWidth?: number; maxHeight?: number } = {}) {
  const anchorRef = useRef<HTMLDivElement | null>(null)
  const [rect, setRect] = useState<{ left: number; top: number; width: number; maxHeight: number; placement: 'up' | 'down' } | null>(null)

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) {
      setRect(null)
      return
    }
    const el = anchorRef.current
    const update = () => {
      const r = el.getBoundingClientRect()
      const margin = 10
      const width = Math.min(Math.max(r.width, opts.minWidth ?? 0), window.innerWidth - margin * 2)
      const left = Math.min(Math.max(margin, r.left), window.innerWidth - width - margin)
      const spaceBelow = window.innerHeight - r.bottom - margin
      const spaceAbove = r.top - margin
      const placement: 'up' | 'down' = spaceBelow < 180 && spaceAbove > spaceBelow ? 'up' : 'down'
      const maxHeight = Math.max(120, Math.min(opts.maxHeight ?? 320, placement === 'up' ? spaceAbove : spaceBelow))
      const top = placement === 'up' ? r.top - 6 : r.bottom + 6
      setRect({ left, top, width, maxHeight, placement })
    }
    update()
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, opts.minWidth, opts.maxHeight])

  return { anchorRef, rect }
}

export function useOutsideClose(open: boolean, refs: React.RefObject<HTMLElement>[], onClose: () => void) {
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node
      if (refs.some((r) => r.current?.contains(target))) return
      onClose()
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, onClose])
}
