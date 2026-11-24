import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAnchoredPopover, useOutsideClose } from './ui/popover'
import { vault, useVault } from '../store'
import { isTauri, platform } from '../lib/platform'
import { docxBlob, downloadBlob, epubBlob, htmlBlob, markdownBlob, printHtml } from '../lib/export'
import { Icon } from './ui/Icon'

type Format = 'md' | 'html' | 'docx' | 'epub' | 'pdf'

const OPTIONS: { id: Format; label: string; hint: string }[] = [
  { id: 'md', label: 'Markdown', hint: '.md 原始文件' },
  { id: 'html', label: 'HTML', hint: '带样式，可直接分享' },
  { id: 'docx', label: 'Word', hint: '.docx，Office 可编辑' },
  { id: 'epub', label: 'EPUB', hint: '按 H2 拆章，电子书阅读器可用' },
  { id: 'pdf', label: 'PDF', hint: '打开打印视图，⌘P 另存为 PDF' },
]

export function ExportMenu() {
  const state = useVault()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<Format | null>(null)
  const { anchorRef, rect } = useAnchoredPopover(open, { minWidth: 240, maxHeight: 300 })
  const popRef = useRef<HTMLDivElement | null>(null)
  useOutsideClose(open, [anchorRef, popRef], () => setOpen(false))
  const doc = state.docs.find((d) => d.id === state.activeId)

  const run = async (format: Format) => {
    if (!doc) return
    setOpen(false)
    setBusy(format)
    try {
      let blob: Blob | null = null
      let name = ''
      if (format === 'md') ({ blob, name } = markdownBlob(doc))
      if (format === 'html') ({ blob, name } = await htmlBlob(doc))
      if (format === 'docx') ({ blob, name } = await docxBlob(doc))
      if (format === 'epub') ({ blob, name } = await epubBlob(doc))

      if (format === 'pdf') {
        if (isTauri) {
          const html = await htmlBlob(doc)
          const path = await platform.saveExport(`${doc.title}.print.html`, html.blob)
          await platform.openPath(path)
          vault.flash('已在默认浏览器打开，按 ⌘P 存为 PDF', 'info')
        } else if (!(await printHtml(doc))) {
          vault.flash('浏览器拦截了打印窗口', 'error')
        }
        return
      }

      if (!blob) return
      if (isTauri) {
        const path = await platform.saveExport(name, blob)
        vault.flash(`已导出到 ${path.split('/').slice(-2).join('/')}`, 'success')
        void platform.openPath(path)
      } else {
        downloadBlob(blob, name)
        vault.flash('已下载导出文件', 'success')
      }
    } catch (e: any) {
      vault.flash(`导出失败：${e?.message ?? e}`, 'error')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div ref={anchorRef} style={{ display: 'inline-flex' }}>
      <button className="tbtn" onClick={() => setOpen((v) => !v)} disabled={!doc} data-tip="导出当前文档" aria-label="导出当前文档">
        <Icon name="upload" size={15} /><span className="label">{busy ? '导出中…' : '导出'}</span>
      </button>
      {open &&
        rect &&
        createPortal(
          <div className="ui-popover export-popover" ref={popRef} style={{ left: rect.left, top: rect.top, width: rect.width, maxHeight: rect.maxHeight, transform: rect.placement === 'up' ? 'translateY(-100%)' : undefined }}>
            {OPTIONS.map((o) => (
              <button key={o.id} className="ui-option export-option" onClick={() => void run(o.id)}>
                <span>{o.label}</span>
                <em>{o.hint}</em>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  )
}
