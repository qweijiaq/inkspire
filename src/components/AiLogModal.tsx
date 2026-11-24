import { useEffect, useMemo, useRef, useState } from 'react'
import { useDialogA11y } from './ui/useDialogA11y'
import { Momo } from './Momo'
import { Icon } from './ui/Icon'
import { listAiEdits, type AiEdit } from '../lib/aiEdits'
import { diffLines, diffStats } from '../lib/textDiff'
import { DiffView } from './ui/DiffView'

interface Props {
  docId: string
  docTitle: string
  onRestore: (id: string) => Promise<boolean> | boolean | void
  onClose: () => void
}

function fmtTime(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return sameDay ? `今天 ${time}` : `${d.getMonth() + 1}-${d.getDate()} ${time}`
}

export function AiLogModal({ docId, docTitle, onRestore, onClose }: Props) {
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const [entries, setEntries] = useState<AiEdit[]>(() => listAiEdits(docId))
  const [expanded, setExpanded] = useState<string | null>(null)
  const [busy, setBusy] = useState('')
  useDialogA11y(dialogRef, onClose)

  useEffect(() => {
    setEntries(listAiEdits(docId))
    setExpanded(null)
  }, [docId])

  const active = entries.find((row) => row.id === expanded) ?? null
  const stats = useMemo(() => {
    if (!active) return null
    return diffStats(diffLines(active.before, active.after))
  }, [active])

  const restore = async (entry: AiEdit) => {
    if (busy) return
    setBusy(entry.id)
    try {
      const ok = await onRestore(entry.id)
      if (ok !== false) onClose()
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="modal-mask" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal ai-log-modal" ref={dialogRef} role="dialog" aria-modal="true" aria-label="AI 操作日志">
        <div className="modal-head">
          <Momo mood="thinking" className="momo-mini" />
          <h3>AI 操作日志 · {docTitle}</h3>
          <button className="close" onClick={onClose} aria-label="关闭 AI 操作日志">
            <Icon name="close" size={16} />
          </button>
        </div>

        <div className="ai-log-body">
          {!entries.length && (
            <div className="empty-hint" style={{ padding: '28px 12px' }}>
              还没有 AI 写入记录。采纳续写、润色、问答插入、图解或封面后，这里会保存前后全文和逐行 diff。
            </div>
          )}
          {entries.map((entry) => {
            const delta = entry.after.length - entry.before.length
            const isOpen = expanded === entry.id
            return (
              <div className={`ai-log-item${isOpen ? ' open' : ''}`} key={entry.id}>
                <div className="ai-log-row">
                  <span className="ai-log-time">{fmtTime(entry.at)}</span>
                  <b>{entry.label}</b>
                  <span className={`ai-log-delta ${delta >= 0 ? 'plus' : 'minus'}`}>
                    {delta >= 0 ? '+' : ''}
                    {delta.toLocaleString()} 字符
                  </span>
                  <button type="button" className="tbtn" onClick={() => setExpanded(isOpen ? null : entry.id)}>
                    {isOpen ? '收起' : '看 diff'}
                  </button>
                  <button
                    type="button"
                    className="tbtn"
                    disabled={!!busy}
                    onClick={() => void restore(entry)}
                    data-tip="回到这次 AI 写入之前；更晚的 AI 写入也会一并失效"
                  >
                    {busy === entry.id ? '回放中…' : '回到这次之前'}
                  </button>
                </div>
                {isOpen && stats && (
                  <div className="ai-log-diff-wrap">
                    <div className="ai-log-stats">
                      新增 {stats.added} 行 · 删除 {stats.removed} 行 · 未变 {stats.unchanged} 行
                    </div>
                    <DiffView before={entry.before} after={entry.after} className="ai-log-diff" />
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <div className="modal-foot">
          <span>日志保存在本机，最多每篇 20 条；只记录 AI 写入，不记录普通编辑。</span>
          <div className="right">
            <button className="tbtn primary" onClick={onClose}>关闭</button>
          </div>
        </div>
      </div>
    </div>
  )
}
