import { useRef, useState } from 'react'
import { vault } from '../store'
import { Momo } from './Momo'
import { formatTime } from '../lib/md'
import { confirmDialog } from '../lib/dialog'
import type { Document } from '../types'
import { useDialogA11y } from './ui/useDialogA11y'
import { Icon } from './ui/Icon'

export function VersionsModal({ doc, onClose, onRestored }: { doc: Document; onClose: () => void; onRestored: () => void }) {
  const [selected, setSelected] = useState<string | null>(doc.versions[doc.versions.length - 1]?.id ?? null)
  const modalRef = useRef<HTMLDivElement | null>(null)
  useDialogA11y(modalRef, onClose)
  const versions = [...doc.versions].reverse()
  const current = doc.versions.find((v) => v.id === selected)
  const preview = current ? current.content.replace(/^---[\s\S]*?---\n/, '').slice(0, 500) : ''

  return (
    <div className="modal-mask" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" ref={modalRef} role="dialog" aria-modal="true" aria-label="版本历史">
        <div className="modal-head">
          <Momo mood="thinking" className="momo-mini" />
          <h3>版本历史 · {doc.title}</h3>
          <button className="close" onClick={onClose} aria-label="关闭版本历史"><Icon name="close" size={16} /></button>
        </div>
        <div className="modal-body">
          {versions.length === 0 && <div className="empty-hint">还没有历史版本。继续编辑并保存后会在这里生成快照。</div>}
          {versions.map((v) => (
            <div
              key={v.id}
              className="version-item"
              role="button"
              tabIndex={0}
              aria-pressed={selected === v.id}
              style={{ background: selected === v.id ? 'var(--brand-soft)' : 'transparent', borderRadius: 8, cursor: 'pointer' }}
              onClick={() => setSelected(v.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  setSelected(v.id)
                }
              }}
            >
              <span className="vtime">{formatTime(v.at)}</span>
              <span className="vpreview">{v.content.replace(/^---[\s\S]*?---\n/, '').slice(0, 80) || '（空）'}</span>
              <span style={{ fontSize: 10, color: 'var(--ink-faint)' }}>{v.reason === 'autosave' ? '自动' : v.reason === 'restore' ? '回滚' : '手动'}</span>
            </div>
          ))}
          {current && (
            <pre style={{ marginTop: 10, background: 'var(--code-bg)', border: '2px solid var(--line-soft)', borderRadius: 10, padding: 10, fontSize: 11, lineHeight: 1.6, whiteSpace: 'pre-wrap', maxHeight: 180, overflow: 'auto' }}>
              {preview}
            </pre>
          )}
        </div>
        <div className="modal-foot">
          <span style={{ fontSize: 11, color: 'var(--ink-faint)' }}>最多保留最近 40 个快照</span>
          <div className="right">
            <button className="tbtn" onClick={onClose}>关闭</button>
            <button
              className="tbtn primary"
              disabled={!current}
              onClick={async () => {
                if (!current) return
                const ok = await confirmDialog({
                  title: '回滚版本',
                  message: '用这个版本覆盖当前内容？当前内容会先存为一个快照，仍可再回滚。',
                  confirmText: '回滚',
                  danger: true,
                })
                if (!ok) return
                await vault.restoreVersion(doc.id, current.id)
                onRestored()
                onClose()
              }}
            >
              回滚到此版本
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
