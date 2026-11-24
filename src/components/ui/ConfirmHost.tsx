import { useEffect, useRef, useState } from 'react'
import { Momo } from '../Momo'
import { setConfirmListener, type ConfirmOptions } from '../../lib/dialog'
import { useDialogA11y } from './useDialogA11y'

interface Pending extends ConfirmOptions {
  resolve: (ok: boolean) => void
}

export function ConfirmHost() {
  const [req, setReq] = useState<Pending | null>(null)
  const confirmRef = useRef<HTMLButtonElement | null>(null)
  const dialogRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    setConfirmListener((next) => setReq(next))
    return () => setConfirmListener(null)
  }, [])

  useEffect(() => {
    if (req) confirmRef.current?.focus()
  }, [req])
  useDialogA11y(
    dialogRef,
    () =>
      setReq((cur) => {
        cur?.resolve(false)
        return null
      }),
    !!req,
  )

  if (!req) return null

  const close = (ok: boolean) => {
    req.resolve(ok)
    setReq(null)
  }

  return (
    <div className="modal-mask confirm-mask" onMouseDown={(e) => e.target === e.currentTarget && close(false)}>
      <div
        className="modal confirm-modal"
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        onKeyDown={(e) => {
          if (e.key === 'Enter') close(true)
        }}
      >
        <div className="modal-head">
          <Momo mood={req.danger ? 'surprised' : 'thinking'} className="momo-mini" />
          <h3>{req.title ?? '确认操作'}</h3>
        </div>
        <div className="modal-body" style={{ fontSize: 13, lineHeight: 1.8 }}>
          {req.message}
        </div>
        <div className="modal-foot">
          <span style={{ fontSize: 11, color: 'var(--ink-faint)' }}>Esc 取消 · Enter 确认</span>
          <div className="right">
            <button className="tbtn" onClick={() => close(false)}>
              {req.cancelText ?? '取消'}
            </button>
            <button ref={confirmRef} className={`tbtn ${req.danger ? 'coral' : 'primary'}`} onClick={() => close(true)}>
              {req.confirmText ?? '确认'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
