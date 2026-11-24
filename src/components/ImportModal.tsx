import { useEffect, useRef, useState } from 'react'
import JSZip from 'jszip'
import { vault, useVault } from '../store'
import { Momo } from './Momo'
import { importFile, toDocuments } from '../lib/importers'
import { Checkbox } from './ui/Checkbox'
import { confirmDialog } from '../lib/dialog'
import { useDialogA11y } from './ui/useDialogA11y'
import { Icon } from './ui/Icon'
import type { ImportResult } from '../types'

interface Job {
  id: string
  fileName: string
  size: number
  status: 'queued' | 'parsing' | 'ready' | 'failed' | 'done'
  progress: number
  result?: ImportResult
  error?: string
  mode: 'split' | 'merge'
  excluded: Set<number>
  /** 低质量导入需要用户明确确认 */
  ack: boolean
}

const SCORE_LABEL: Record<string, string> = {
  textExtraction: '文本提取',
  structure: '结构还原',
  chapterSplit: '章节切分',
  tables: '表格',
  images: '图片',
  formulas: '公式',
}

export function ImportModal({ onClose, initialFiles }: { onClose: () => void; initialFiles?: File[] }) {
  const state = useVault()
  const [jobs, setJobs] = useState<Job[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [folder, setFolder] = useState('导入')
  const [showPreview, setShowPreview] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const folderRef = useRef<HTMLInputElement | null>(null)
  const modalRef = useRef<HTMLDivElement | null>(null)
  useDialogA11y(modalRef, onClose)

  const active = jobs.find((j) => j.id === activeId) ?? null

  useEffect(() => {
    if (initialFiles?.length) void addFiles(initialFiles)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const update = (id: string, patch: Partial<Job>) => setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...patch } : j)))

  const addFiles = async (files: FileList | File[]) => {
    const incoming = Array.from(files)
    const list: File[] = []
    const zipErrors: { fileName: string; error: string }[] = []
    for (const file of incoming) {
      if (!/\.zip$/i.test(file.name)) {
        list.push(file)
        continue
      }
      try {
        const zip = await JSZip.loadAsync(file)
        const entries = Object.values(zip.files).filter((entry) => !entry.dir)
        for (const entry of entries) {
          if (!/\.(md|markdown|txt|html?|docx|pdf|epub)$/i.test(entry.name)) continue
          const blob = await entry.async('blob')
          const name = entry.name.split('/').pop() || entry.name
          list.push(new File([blob], name, { type: blob.type }))
        }
        if (!entries.length) zipErrors.push({ fileName: file.name, error: '压缩包是空的' })
      } catch (e: any) {
        zipErrors.push({ fileName: file.name, error: `无法解压：${e?.message ?? e}` })
      }
    }

    const created: Job[] = list.map((f) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      fileName: f.name,
      size: f.size,
      status: 'queued',
      progress: 0,
      mode: 'split',
      excluded: new Set(),
      ack: true,
    }))
    const failed: Job[] = zipErrors.map((z) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      fileName: z.fileName,
      size: 0,
      status: 'failed',
      progress: 0,
      mode: 'merge',
      excluded: new Set(),
      ack: true,
      error: z.error,
    }))
    const allCreated = [...created, ...failed]
    setJobs((prev) => [...prev, ...allCreated])
    if (!activeId && allCreated[0]) setActiveId(allCreated[0].id)

    for (let i = 0; i < list.length; i++) {
      const file = list[i]
      const job = created[i]
      update(job.id, { status: 'parsing', progress: 0.05 })
      try {
        const result = await importFile(file, (p) => update(job.id, { progress: p }))
        update(job.id, {
          status: 'ready',
          progress: 1,
          result,
          mode: result.chapters.length > 1 ? 'split' : 'merge',
          ack: !result.needsConfirmation,
        })
      } catch (e: any) {
        update(job.id, { status: 'failed', error: e?.message ?? String(e) })
      }
    }
    if (list.length) vault.flash(`已加入 ${list.length} 个文件${zipErrors.length ? `，${zipErrors.length} 个压缩包失败` : ''}`, zipErrors.length ? 'info' : 'success')
  }

  const commit = async () => {
    let count = 0
    let firstId: string | null = null
    const ready = jobs.filter((j) => j.status === 'ready' && j.result)
    const unconfirmed = ready.filter((j) => j.result!.needsConfirmation && !j.ack)
    if (unconfirmed.length) {
      const ok = await confirmDialog({
        title: '质量较低，仍要导入？',
        message: `${unconfirmed.map((j) => j.fileName).join('、')} 的文本还原或结构可能存在明显缺口（质量低于 90% 或含高风险诊断）。导入后仍可手动修正。`,
        confirmText: '仍然导入',
        danger: true,
      })
      if (!ok) return
    }
    const pending: { doc: ReturnType<typeof toDocuments>[number]; job: Job }[] = []
    for (const job of ready) {
      const result = job.result!
      const chapters = result.chapters.filter((_, i) => !job.excluded.has(i))
      if (!chapters.length && job.mode === 'split') continue
      const docs = toDocuments({ ...result, chapters }, job.mode, folder.trim() || '导入')
      for (const d of docs) pending.push({ doc: d, job })
      update(job.id, { status: 'done' })
    }

    // 批量导入时把指向同批文件的链接改写成双链，Notion 的 UUID 文件名也能对上
    const titleMap = new Map<string, string>()
    const uuidMap = new Map<string, string>()
    const firstTitle = new Map<string, string>()
    for (const { doc, job } of pending) {
      const base = (doc.path.split('/').pop() ?? '').replace(/\.md$/i, '').toLowerCase()
      titleMap.set(base, doc.frontMatter.title)
      titleMap.set(doc.frontMatter.title.toLowerCase(), doc.frontMatter.title)
      if (!firstTitle.has(job.fileName)) firstTitle.set(job.fileName, doc.frontMatter.title)
      const uuid = job.fileName.match(/[0-9a-f]{32}/i)?.[0]?.toLowerCase()
      if (uuid && !uuidMap.has(uuid)) uuidMap.set(uuid, doc.frontMatter.title)
    }
    for (const [name, title] of firstTitle) {
      titleMap.set(name.replace(/\.[^.]+$/, '').toLowerCase(), title)
    }
    const repairLinks = (content: string) =>
      content.replace(/\[([^\]]+)\]\(([^)\s]+\.md)(#[^)]*)?\)/g, (whole, label: string, href: string) => {
        if (/^(https?:|mailto:)/i.test(href)) return whole
        let clean = href.split('#')[0].split('/').pop() ?? ''
        try {
          clean = decodeURIComponent(clean)
        } catch {
          /* 保留原文件名 */
        }
        clean = clean.replace(/\.md$/i, '').trim().toLowerCase()
        const uuid = clean.match(/[0-9a-f]{32}/i)?.[0]
        const target = (uuid && uuidMap.get(uuid)) || titleMap.get(clean)
        if (!target) return whole
        const text = label.trim()
        return `[[${target}${text && text !== target ? `|${text}` : ''}]]`
      })

    for (const { doc } of pending) {
      const created = await vault.importDoc({ ...doc, content: repairLinks(doc.content) } as any)
      if (!firstId) firstId = created.id
      count++
    }
    if (count) {
      vault.flash(`已导入 ${count} 篇文档`, 'success')
      vault.pet('happy', '都搬进来啦！', 2400)
      if (firstId) await vault.setActive(firstId)
      onClose()
    } else {
      vault.flash('没有可导入的文档', 'error')
    }
  }

  const qualityColor = (v: number) => (v >= 0.85 ? 'var(--mint)' : v >= 0.6 ? 'var(--yellow)' : 'var(--coral)')
  const qualityTextColor = (v: number) => (v >= 0.85 ? 'var(--mint-strong)' : v >= 0.6 ? 'var(--yellow-strong)' : 'var(--coral-strong)')

  return (
    <div className="modal-mask" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide" ref={modalRef} role="dialog" aria-modal="true" aria-label="导入文件">
        <div className="modal-head">
          <Momo mood="happy" className="momo-mini" />
          <h3>导入文件</h3>
          <span style={{ fontSize: 11, color: 'var(--ink-faint)' }}>Markdown / TXT / HTML / DOCX / PDF / EPUB</span>
          <button className="close" onClick={onClose} aria-label="关闭导入">
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="modal-body">
          <div
            className={`dropzone${dragOver ? ' over' : ''}`}
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragOver(false)
              if (e.dataTransfer.files?.length) void addFiles(e.dataTransfer.files)
            }}
          >
            <Momo mood="thinking" className="big" />
            <div>把文件或文件夹拖到这里，也可以选择（可多选）</div>
            <div style={{ fontSize: 10.5, marginTop: 4 }}>章节识别会按标题层级与内容长度收敛，避免把每个段落切成一章</div>
            <div className="dropzone-actions">
              <button type="button" className="tbtn" onClick={(e) => { e.stopPropagation(); inputRef.current?.click() }}>
                <Icon name="file" size={14} /> 选择文件
              </button>
              <button type="button" className="tbtn" onClick={(e) => { e.stopPropagation(); folderRef.current?.click() }}>
                <Icon name="folder" size={14} /> 选择文件夹
              </button>
              <span>支持 .zip 压缩包与整目录导入</span>
            </div>
            <input ref={inputRef} type="file" multiple accept=".md,.markdown,.txt,.html,.htm,.docx,.pdf,.epub,.zip" style={{ display: 'none' }} onChange={(e) => { if (e.target.files) void addFiles(e.target.files); e.target.value = '' }} />
            <input
              ref={folderRef}
              type="file"
              multiple
              style={{ display: 'none' }}
              {...({ webkitdirectory: 'true', directory: 'true' } as any)}
              onChange={(e) => { if (e.target.files) void addFiles(e.target.files); e.target.value = '' }}
            />
          </div>

          {jobs.length > 0 && (
            <div style={{ marginTop: 14 }}>
              {jobs.map((j) => (
                <div
                  key={j.id}
                  className="import-job"
                  style={{ cursor: 'pointer', background: activeId === j.id ? 'var(--brand-soft)' : 'transparent', borderRadius: 8, padding: '8px 6px' }}
                  onClick={() => setActiveId(j.id)}
                >
                  <Momo mood={j.status === 'failed' ? 'surprised' : j.status === 'ready' ? 'happy' : 'thinking'} className="momo-mini" />
                  <span className="name">{j.fileName}</span>
                  {j.status === 'parsing' && <span className="pbar"><i style={{ width: `${Math.round(j.progress * 100)}%` }} /></span>}
                  {j.status === 'ready' && j.result && <span className="badge">质量 {(j.result.quality.overall * 100).toFixed(0)}%</span>}
                  {j.status === 'failed' && <span className="badge" style={{ background: 'var(--coral-soft)', color: 'var(--coral-strong)' }}>失败</span>}
                  {j.status === 'done' && <span className="badge">已导入</span>}
                  <button
                    className="icon-btn"
                    style={{ color: 'var(--ink-faint)' }}
                    aria-label={`移除 ${j.fileName}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      setJobs((prev) => prev.filter((x) => x.id !== j.id))
                      if (activeId === j.id) setActiveId(null)
                    }}
                  >
                    <Icon name="close" size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {active?.status === 'failed' && (
            <div className="diag high" style={{ marginTop: 10 }}>
              <span className="sev">失败</span>
              <span>{active.error}</span>
            </div>
          )}

          {active?.status === 'ready' && active.result && (
            <div style={{ marginTop: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <b style={{ fontSize: 13 }}>{active.fileName}</b>
                <span className="badge" style={{ background: 'var(--brand-soft)', color: 'var(--brand)', fontSize: 10, padding: '2px 7px', borderRadius: 99 }}>
                  {active.result.importer.toUpperCase()} · {active.result.tier} 档
                </span>
                <span style={{ fontSize: 11, color: 'var(--ink-faint)' }}>
                  {active.result.stats.characters.toLocaleString()} 字 · {active.result.chapters.length} 章
                  {active.result.stats.pageCount ? ` · ${active.result.stats.pageCount} 页` : ''}
                </span>
                <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 800, color: qualityTextColor(active.result.quality.overall) }}>
                  质量 {(active.result.quality.overall * 100).toFixed(0)}%
                </span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 18px', marginTop: 8 }}>
                {Object.entries(active.result.quality.scores).map(([k, v]) => (
                  <div className="quality-row" key={k}>
                    <span className="label">{SCORE_LABEL[k] ?? k}</span>
                    <span className="bar">
                      <i style={{ width: `${Math.round(v * 100)}%`, background: qualityColor(v) }} />
                    </span>
                    <span className="val">{Math.round(v * 100)}</span>
                  </div>
                ))}
              </div>

              {active.result.diagnostics.map((d, i) => (
                <div key={i} className={`diag ${d.severity}`}>
                  <span className="sev">{d.severity}</span>
                  <span>{d.message}</span>
                </div>
              ))}

              {active.result.needsConfirmation && (
                <div className="diag high" style={{ marginTop: 8, alignItems: 'center' }}>
                  <Checkbox
                    checked={active.ack}
                    ariaLabel="确认低质量导入"
                    onChange={(checked) => update(active.id, { ack: checked })}
                  />
                  <span>质量偏低或含高风险诊断；我确认仍要导入这个文件。</span>
                </div>
              )}

              <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
                <div className="seg">
                  <button className={active.mode === 'split' ? 'on' : ''} onClick={() => update(active.id, { mode: 'split' })}>
                    拆成 {active.result.chapters.length} 篇
                  </button>
                  <button className={active.mode === 'merge' ? 'on' : ''} onClick={() => update(active.id, { mode: 'merge' })}>
                    合并为 1 篇
                  </button>
                </div>
                <label style={{ fontSize: 11.5, color: 'var(--ink-soft)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  导入到
                  <input
                    value={folder}
                    onChange={(e) => setFolder(e.target.value)}
                    style={{ width: 110, height: 28, border: '2px solid var(--line-soft)', borderRadius: 7, padding: '0 7px', fontSize: 11.5, background: 'var(--card)', outline: 'none' }}
                  />
                </label>
                <button className="chip clickable" onClick={() => setShowPreview((v) => !v)}>
                  {showPreview ? '收起' : '预览'} Markdown
                </button>
              </div>

              {active.mode === 'split' && (
                <div className="chapter-list">
                  {active.result.chapters.map((ch, i) => (
                    <div
                      className="chapter-item"
                      key={i}
                      onClick={() => {
                        const next = new Set(active.excluded)
                        next.has(i) ? next.delete(i) : next.add(i)
                        update(active.id, { excluded: next })
                      }}
                      style={{ cursor: 'pointer' }}
                    >
                      <Checkbox
                        checked={!active.excluded.has(i)}
                        ariaLabel={`导入 ${ch.title}`}
                        onChange={(checked) => {
                          const next = new Set(active.excluded)
                          checked ? next.delete(i) : next.add(i)
                          update(active.id, { excluded: next })
                        }}
                      />
                      <span className="idx">{String(i + 1).padStart(2, '0')}</span>
                      <span className="ct">{ch.title}</span>
                      <span className="cl">{ch.markdown.replace(/\s/g, '').length} 字</span>
                    </div>
                  ))}
                </div>
              )}

              {showPreview && (
                <pre
                  style={{
                    marginTop: 10,
                    maxHeight: 220,
                    overflow: 'auto',
                    background: 'var(--code-bg)',
                    border: '2px solid var(--line-soft)',
                    borderRadius: 10,
                    padding: 10,
                    fontSize: 11,
                    lineHeight: 1.6,
                    whiteSpace: 'pre-wrap',
                    fontFamily: 'var(--mono)',
                  }}
                >
                  {active.result.markdown.slice(0, 3000)}
                </pre>
              )}
            </div>
          )}
        </div>
        <div className="modal-foot">
          <span style={{ fontSize: 11, color: 'var(--ink-faint)' }}>
            {jobs.filter((j) => j.status === 'ready').length} 个文件待导入 · 章节可在上方逐条取消
          </span>
          <div className="right">
            <button className="tbtn" onClick={onClose}>
              取消
            </button>
            <button className="tbtn primary" disabled={!jobs.some((j) => j.status === 'ready')} onClick={() => void commit()}>
              确认导入
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
