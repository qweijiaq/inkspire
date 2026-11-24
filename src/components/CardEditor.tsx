import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Momo } from './Momo'
import { vault } from '../store'
import { buildMessages, streamChat } from '../lib/ai'
import { apiKeyFor, needsApiKey } from '../lib/providers'
import { loadMemories } from '../lib/memories'
import { Icon } from './ui/Icon'
import { useDialogA11y } from './ui/useDialogA11y'

export interface CardDraft {
  docId: string
  docTitle: string
  source: string
  answer: string
}

interface Props {
  draft: CardDraft
  onClose: () => void
  onSave: (question: string, answer: string) => void
}

export function CardEditor({ draft, onClose, onSave }: Props) {
  const [question, setQuestion] = useState('这段话的关键点是什么？')
  const [answer, setAnswer] = useState(draft.answer)
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLTextAreaElement | null>(null)
  const dialogRef = useRef<HTMLDivElement | null>(null)
  useDialogA11y(dialogRef, onClose)

  useEffect(() => {
    setAnswer(draft.answer)
    window.setTimeout(() => ref.current?.focus(), 40)
  }, [draft])

  return createPortal(
    <div className="learning-card-mask" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="learning-card-dialog"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="制作记忆卡"
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose()
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            if (question.trim() && answer.trim()) onSave(question, answer)
          }
        }}
      >
        <div className="learning-card-head">
          <Momo mood="happy" className="momo-mini" />
          <div>
            <b>让墨墨记住</b>
            <span>一张卡只问一件事，答案尽量不超过 80 字</span>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭"><Icon name="close" size={16} /></button>
        </div>

        <label className="learning-field">
          <span>问题</span>
          <input value={question} onChange={(e) => setQuestion(e.target.value)} aria-label="问题" />
        </label>
        <label className="learning-field">
          <span>答案</span>
          <textarea
            ref={ref}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            rows={4}
            aria-label="答案"
          />
        </label>
        <div className="learning-source">来源：{draft.docTitle} · “{draft.source.slice(0, 80)}{draft.source.length > 80 ? '…' : ''}”</div>

        <div className="learning-card-actions">
          <button
            className="tbtn"
            type="button"
            disabled={busy}
            onClick={async () => {
              const ai = vault.state.settings.ai
              if (!ai.enabled) {
                vault.flash('先在设置里启用 AI', 'error')
                return
              }
              if (needsApiKey(ai.provider) && !apiKeyFor(ai)) {
                const key = await vault.ensureProviderKey(ai.provider)
                if (!key) {
                  vault.flash('这个服务商还没有配置 API Key', 'error')
                  return
                }
              }
              if (!vault.checkAiBudget((vault.state.settings.ai.contextChars || 6000) + 400)) return
              setBusy(true)
              try {
                const messages = buildMessages(
                  'custom',
                  { title: draft.docTitle, headings: [], selection: draft.answer, before: '', after: '', memories: loadMemories().map((m) => m.text), persona: vault.state.settings.persona, budget: vault.state.settings.ai.contextChars || 6000 },
                  '把下面内容做成一张原子化问答卡。问题要能独立提问，答案不超过 80 字。严格只输出两行：\n问题：……\n答案：……\n不要输出其他内容。',
                )
                let text = ''
                await streamChat(vault.state.settings.ai, messages, (delta) => { text += delta })
                vault.recordUsage(JSON.stringify(messages).length, text.length)
                const q = text.match(/(?:问题|Q)[：:]\s*(.+)/i)?.[1]?.trim()
                const a = text.match(/(?:答案|A)[：:]\s*([\s\S]+)/i)?.[1]?.trim()
                if (q) setQuestion(q)
                if (a) setAnswer(a)
                else if (text.trim()) setAnswer(text.trim())
              } catch (e: any) {
                vault.flash(`出题失败：${e?.message ?? e}`, 'error')
              } finally {
                setBusy(false)
              }
            }}
          >
            {busy ? '出题中…' : 'AI 出题'}
          </button>
          <button className="tbtn" type="button" onClick={onClose}>取消</button>
          <button className="tbtn primary" type="button" disabled={!answer.trim()} onClick={() => onSave(question, answer)}>
            存为卡片
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
