import { useEffect, useMemo, useRef, useState } from 'react'
import { Momo } from './Momo'
import type { MermaidEditPayload, TableEditPayload } from '../editor/livePreview'
import { Icon } from './ui/Icon'
import { useDialogA11y } from './ui/useDialogA11y'

export type BlockEditState =
  | ({ kind: 'table' } & TableEditPayload)
  | ({ kind: 'mermaid' } & MermaidEditPayload)

interface Props {
  value: BlockEditState | null
  onClose: () => void
  onSave: (markdown: string) => void
}

const ALIGNS = [
  { value: 'left', label: '左对齐', icon: 'alignLeft' as const },
  { value: 'center', label: '居中', icon: 'alignCenter' as const },
  { value: 'right', label: '右对齐', icon: 'alignRight' as const },
]

function padRows(rows: string[][], aligns: string[]) {
  const cols = Math.max(2, ...rows.map((r) => r.length), aligns.length)
  return rows.map((r) => Array.from({ length: cols }, (_, i) => r[i] ?? ''))
}

function tableMarkdown(rows: string[][], aligns: string[]) {
  const esc = (cell: string) => cell.replace(/\|/g, '\\|').replace(/\n/g, ' ')
  const header = rows[0] ?? []
  const sep = Array.from({ length: header.length }, (_, i) => {
    const a = aligns[i]
    return a === 'center' ? ':---:' : a === 'right' ? '---:' : a === 'left' ? ':---' : '---'
  })
  const line = (cells: string[]) => `| ${cells.map(esc).join(' | ')} |`
  return [line(header), line(sep), ...rows.slice(1).map(line)].join('\n')
}

function TableEditor({ value, onSave, onClose }: { value: TableEditPayload; onSave: (md: string) => void; onClose: () => void }) {
  const [rows, setRows] = useState<string[][]>(() => padRows(value.rows, value.aligns))
  const [aligns, setAligns] = useState<string[]>(() => Array.from({ length: padRows(value.rows, value.aligns)[0].length }, (_, i) => value.aligns[i] ?? ''))
  const [active, setActive] = useState({ row: 0, col: 0 })
  const firstRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    const next = padRows(value.rows, value.aligns)
    setRows(next)
    setAligns(Array.from({ length: next[0]?.length ?? 2 }, (_, i) => value.aligns[i] ?? ''))
    setActive({ row: 0, col: 0 })
    requestAnimationFrame(() => firstRef.current?.focus())
  }, [value.from, value.to])

  const cols = rows[0]?.length ?? 2
  const activeCol = Math.min(active.col, cols - 1)
  const activeRow = Math.min(active.row, rows.length - 1)
  const setCell = (r: number, c: number, text: string) =>
    setRows((prev) => prev.map((row, ri) => (ri === r ? row.map((cell, ci) => (ci === c ? text : cell)) : row)))

  const addRow = () => {
    setRows((prev) => [...prev, Array.from({ length: cols }, () => '')])
    setActive({ row: rows.length, col: activeCol })
  }
  const addCol = () => {
    setRows((prev) => prev.map((row) => [...row, '']))
    setAligns((prev) => [...prev, 'left'])
    setActive({ row: activeRow, col: cols })
  }
  const removeRow = (r: number) => {
    if (rows.length <= 1) return
    setRows((prev) => prev.filter((_, i) => i !== r))
    setActive((prev) => ({ ...prev, row: Math.max(0, Math.min(prev.row, rows.length - 2)) }))
  }
  const removeCol = () => {
    if (cols <= 1) return
    const c = activeCol
    setRows((prev) => prev.map((row) => row.filter((_, i) => i !== c)))
    setAligns((prev) => prev.filter((_, i) => i !== c))
    setActive((prev) => ({ ...prev, col: Math.max(0, c - 1) }))
  }
  const setAlign = (v: string) => setAligns((prev) => prev.map((x, i) => (i === activeCol ? v : x)))

  return (
    <>
      <div className="block-editor-toolbar">
        <div className="block-tool-group">
          <button className="tbtn" type="button" onClick={addRow}>
            <Icon name="rowPlus" size={15} /> 加行
          </button>
          <button className="tbtn" type="button" onClick={addCol}>
            <Icon name="colPlus" size={15} /> 加列
          </button>
        </div>
        <span className="block-tool-sep" />
        <div className="block-align-group" role="group" aria-label={`第 ${activeCol + 1} 列对齐`}>
          <span className="block-align-label">第 {activeCol + 1} 列</span>
          {ALIGNS.map((a) => (
            <button
              key={a.value}
              type="button"
              className={(aligns[activeCol] || 'left') === a.value ? 'on' : ''}
              onClick={() => setAlign(a.value)}
              data-tip={a.label}
              aria-label={a.label}
              aria-pressed={(aligns[activeCol] || 'left') === a.value}
            >
              <Icon name={a.icon} size={14} />
            </button>
          ))}
        </div>
        <span className="block-tool-sep" />
        <button className="block-tool-danger" type="button" onClick={removeCol} disabled={cols <= 1} data-tip="删除当前列">
          <Icon name="trash" size={14} /> 删除列
        </button>
        <span className="block-editor-tip">当前：第 {activeRow + 1} 行 · 第 {activeCol + 1} 列</span>
      </div>

      <div className="block-table-wrap">
        <table className="block-table">
          <thead>
            <tr>
              <th className="block-row-num" aria-label="行号">#</th>
              {Array.from({ length: cols }, (_, c) => (
                <th key={c} className={activeRow === 0 && activeCol === c ? 'active' : ''}>
                  <input
                    ref={c === 0 ? firstRef : undefined}
                    value={rows[0]?.[c] ?? ''}
                    onChange={(e) => setCell(0, c, e.target.value)}
                    onFocus={() => setActive({ row: 0, col: c })}
                    aria-label={`表头 ${c + 1}`}
                  />
                </th>
              ))}
              <th className="block-col-del" aria-label="列操作" />
            </tr>
          </thead>
          <tbody>
            {rows.slice(1).map((row, ri) => (
              <tr key={ri + 1}>
                <td className="block-row-num">{ri + 2}</td>
                {Array.from({ length: cols }, (_, c) => (
                  <td key={c} className={activeRow === ri + 1 && activeCol === c ? 'active' : ''}>
                    <input
                      value={row[c] ?? ''}
                      onChange={(e) => setCell(ri + 1, c, e.target.value)}
                      onFocus={() => setActive({ row: ri + 1, col: c })}
                      aria-label={`第 ${ri + 2} 行第 ${c + 1} 列`}
                    />
                  </td>
                ))}
                <td className="block-row-del">
                  <button type="button" onClick={() => removeRow(ri + 1)} data-tip="删除这一行" aria-label="删除这一行">
                    <Icon name="trash" size={13} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="block-editor-actions">
        <span className="block-editor-count">{rows.length} 行 × {cols} 列 · 第一行是表头 · Tab 跳到下一格</span>
        <div className="block-editor-buttons">
          <button className="tbtn" type="button" onClick={onClose}>取消</button>
          <button className="tbtn primary" type="button" onClick={() => onSave(tableMarkdown(rows, aligns))}>保存表格</button>
        </div>
      </div>
    </>
  )
}

function MermaidEditor({ value, onSave, onClose }: { value: MermaidEditPayload; onSave: (md: string) => void; onClose: () => void }) {
  const [code, setCode] = useState(value.code)
  const [error, setError] = useState('')
  const [svg, setSvg] = useState('')
  const areaRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    setCode(value.code)
    requestAnimationFrame(() => areaRef.current?.focus())
  }, [value.from, value.to])

  useEffect(() => {
    let cancelled = false
    setError('')
    const timer = window.setTimeout(() => {
      const source = code.trim()
      if (!source) {
        setSvg('')
        return
      }
      void import('mermaid')
        .then(async (mod) => {
          const mermaid = mod.default
          const dark = document.documentElement.dataset.theme === 'night'
          mermaid.initialize({ startOnLoad: false, theme: dark ? 'dark' : 'base', securityLevel: 'strict', fontFamily: 'inherit' })
          const { svg: out } = await mermaid.render(`block-mmd-${Date.now()}`, source)
          if (!cancelled) setSvg(out)
        })
        .catch((e: any) => {
          if (!cancelled) {
            setSvg('')
            setError(e?.message ? String(e.message).slice(0, 160) : '语法有误，检查一下节点或箭头')
          }
        })
    }, 300)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [code])

  const fence = String.fromCharCode(96).repeat(3)
  return (
    <>
      <div className="block-mermaid-grid">
        <div className="block-mermaid-code">
          <label>Mermaid 源码</label>
          <textarea
            ref={areaRef}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            spellCheck={false}
            placeholder="graph TD&#10;  A[想法] --> B[笔记]"
          />
        </div>
        <div className="block-mermaid-preview">
          <label>预览</label>
          <div className="block-mermaid-canvas">
            {svg ? <div dangerouslySetInnerHTML={{ __html: svg }} /> : <span>{error || '输入后在这里预览'}</span>}
          </div>
        </div>
      </div>
      <div className="block-editor-actions">
        <button className="tbtn" type="button" onClick={onClose}>取消</button>
        <button
          className="tbtn primary"
          type="button"
          onClick={() => onSave(`${fence}mermaid\n${code.trim()}\n${fence}`)}
        >
          保存图解
        </button>
      </div>
    </>
  )
}

export function BlockEditor({ value, onClose, onSave }: Props) {
  const title = useMemo(() => (value?.kind === 'table' ? '编辑表格' : '编辑 Mermaid 图解'), [value?.kind])
  const dialogRef = useRef<HTMLDivElement | null>(null)
  useDialogA11y(dialogRef, onClose, !!value)
  if (!value) return null
  return (
    <div className="block-editor-mask" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="block-editor"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            onClose()
          }
        }}
      >
        <div className="block-editor-head">
          <Momo mood={value.kind === 'table' ? 'thinking' : 'happy'} className="momo-mini" />
          <div>
            <b>{title}</b>
            <span>不离开阅读模式，保存后直接回写 Markdown</span>
          </div>
          <button className="block-editor-close" type="button" onClick={onClose} aria-label="关闭"><Icon name="close" size={16} /></button>
        </div>
        <div className="block-editor-body">
          {value.kind === 'table'
            ? <TableEditor value={value} onSave={onSave} onClose={onClose} />
            : <MermaidEditor value={value} onSave={onSave} onClose={onClose} />}
        </div>
      </div>
    </div>
  )
}
