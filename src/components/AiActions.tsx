import { useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AI_ACTIONS, AI_ACTION_COUNT, type AiAction } from '../lib/aiActions'
import { Momo } from './Momo'
import { useDialogA11y } from './ui/useDialogA11y'
import { Icon } from './ui/Icon'

interface Props {
  onClose: () => void
  onRun: (action: AiAction) => void
}

const CATEGORIES = ['全部', '写作', '结构', '知识', '代码', '工作'] as const

export function AiActions({ onClose, onRun }: Props) {
  const [q, setQ] = useState('')
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>('全部')
  const dialogRef = useRef<HTMLDivElement | null>(null)
  useDialogA11y(dialogRef, onClose)

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return AI_ACTIONS.filter((a) => {
      if (category !== '全部' && a.category !== category) return false
      if (!needle) return true
      return `${a.label} ${a.hint} ${a.category}`.toLowerCase().includes(needle)
    })
  }, [q, category])

  return createPortal(
    <div className="ai-library-mask" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="ai-library" ref={dialogRef} role="dialog" aria-modal="true" aria-label="AI 动作库">
        <div className="ai-actions-head">
          <Momo mood="thinking" className="momo-mini" />
          <div>
            <b>AI 动作库</b>
            <span>{AI_ACTION_COUNT} 个可执行动作 · 基于当前文档与选区</span>
          </div>
          <button type="button" className="block-editor-close" onClick={onClose} aria-label="关闭"><Icon name="close" size={16} /></button>
        </div>

        <div className="ai-actions-filters">
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose()
              if (e.key === 'Enter' && list[0]) onRun(list[0])
            }}
            placeholder="搜索动作：续写、周报、找 bug、用户故事…"
            aria-label="搜索 AI 动作"
          />
          <div className="ai-actions-tabs">
            {CATEGORIES.map((c) => (
              <button key={c} type="button" className={c === category ? 'on' : ''} onClick={() => setCategory(c)}>
                {c}
              </button>
            ))}
          </div>
        </div>

        <div className="ai-actions-list">
          {list.map((a) => (
            <button key={a.id} type="button" className="ai-action-item" onClick={() => onRun(a)}>
              <span className="ai-action-cat">{a.category}</span>
              <b>{a.label}</b>
              <em>{a.hint}</em>
            </button>
          ))}
          {!list.length && <div className="ai-actions-empty">没有匹配的动作。换个词，或切到「全部」。</div>}
        </div>

        <div className="ai-actions-foot">选中文字后会以选区为中心；没有选区则基于当前文档与光标上下文。</div>
      </div>
    </div>,
    document.body,
  )
}
