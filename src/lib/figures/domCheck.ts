import type { FigureIssue } from './index'

/**
 * 渲染后检查：用 SVG 的真实 bbox 找画布溢出和文字互相压住。
 * 这是 T-051 里不依赖模型的“像素级”部分；只在预览 DOM 上跑。
 */
export function checkRenderedFigure(container: HTMLElement | null): FigureIssue[] {
  const svg = container?.querySelector('svg') as SVGSVGElement | null
  if (!svg) return []
  const vb = svg.viewBox?.baseVal
  if (!vb || !vb.width || !vb.height) return []
  const issues: FigureIssue[] = []
  const texts = [...svg.querySelectorAll('text')].filter((t) => (t.textContent ?? '').trim())

  const boxes: { el: SVGTextElement; b: DOMRect }[] = []
  for (const text of texts) {
    let b: DOMRect
    try {
      b = text.getBBox()
    } catch {
      continue
    }
    boxes.push({ el: text, b })
    if (b.x < -1 || b.y < -1 || b.x + b.width > vb.width + 1 || b.y + b.height > vb.height + 1) {
      issues.push({
        level: 'error',
        code: 'TEXT_OVERFLOW_CANVAS',
        message: `文字“${(text.textContent ?? '').slice(0, 18)}”超出画布`,
      })
    }
    const node = text.closest('.fig-node') as SVGGElement | null
    const rect = node?.querySelector('rect') as SVGRectElement | null
    if (rect) {
      try {
        const r = rect.getBBox()
        if (b.x < r.x + 2 || b.y < r.y + 2 || b.x + b.width > r.x + r.width - 2 || b.y + b.height > r.y + r.height - 2) {
          issues.push({
            level: 'error',
            code: 'TEXT_OVERFLOW_NODE',
            message: `节点“${(text.textContent ?? '').slice(0, 16)}”文字超出节点框`,
          })
        }
      } catch {
        /* ignore */
      }
    }
  }

  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]
      const b = boxes[j]
      const x = Math.max(0, Math.min(a.b.x + a.b.width, b.b.x + b.b.width) - Math.max(a.b.x, b.b.x))
      const y = Math.max(0, Math.min(a.b.y + a.b.height, b.b.y + b.b.height) - Math.max(a.b.y, b.b.y))
      if (x * y > 24) {
        issues.push({
          level: 'warn',
          code: 'TEXT_OVERLAP',
          message: `“${(a.el.textContent ?? '').slice(0, 10)}”与“${(b.el.textContent ?? '').slice(0, 10)}”可能重叠`,
        })
      }
    }
  }
  return issues
}
