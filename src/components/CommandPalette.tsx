import { useEffect, useMemo, useRef, useState } from 'react'
import { vault, useVault } from '../store'
import { useDialogA11y } from './ui/useDialogA11y'

export interface Command {
  label: string
  hint?: string
  kbd?: string
  run: () => void
}

export function CommandPalette({ onClose, onOpenDoc, onNewDoc, onOpenImport, onOpenSettings, onOpenVersions, onOpenGraph, onOpenHealth, onReloadFromDisk }: {
  onClose: () => void
  onOpenDoc: (id: string, line?: number) => void
  onNewDoc: () => void
  onOpenImport: () => void
  onOpenSettings: () => void
  onOpenVersions: () => void
  onOpenGraph: () => void
  onOpenHealth: () => void
  onReloadFromDisk: () => void
}) {
  const state = useVault()
  const [q, setQ] = useState('')
  const [index, setIndex] = useState(0)
  const listRef = useRef<HTMLDivElement | null>(null)
  const dialogRef = useRef<HTMLDivElement | null>(null)
  useDialogA11y(dialogRef, onClose)

  const commands = useMemo<Command[]>(() => {
    const docs = state.docs
    const docCommands: Command[] = docs.slice(0, 30).map((d) => ({
      label: `打开：${d.title}`,
      hint: d.path,
      run: () => {
        onClose()
        onOpenDoc(d.id)
      },
    }))
    return [
      { label: '新建文档', kbd: '⌘N', run: () => { onClose(); onNewDoc() } },
      { label: '打开今日笔记（Daily Note）', kbd: '⌘⇧D', run: () => { onClose(); void vault.openDailyNote() } },
      { label: '从模板新建：会议纪要', run: () => { onClose(); void vault.createFromTemplate('meeting') } },
      { label: '从模板新建：读书笔记', run: () => { onClose(); void vault.createFromTemplate('reading') } },
      { label: '从模板新建：周报', run: () => { onClose(); void vault.createFromTemplate('weekly') } },
      { label: '从模板新建：项目计划', run: () => { onClose(); void vault.createFromTemplate('project') } },
      { label: '导入文件（PDF / EPUB / DOCX…）', run: () => { onClose(); onOpenImport() } },
      { label: '在全部文档中搜索', kbd: '⌘⇧F', run: () => { onClose(); vault.setSidebar('search') } },
      { label: '打开设置', run: () => { onClose(); onOpenSettings() } },
      { label: '版本历史', run: () => { onClose(); onOpenVersions() } },
      { label: '文档体检：断链 / 孤岛 / 重复标题', run: () => { onClose(); onOpenHealth() } },
      { label: '知识图谱：查看双链关系', run: () => { onClose(); onOpenGraph() } },
      {
        label: state.settings.theme === 'night' ? '切换到纸张主题' : '切换到夜间主题',
        run: () => { onClose(); void vault.updateSettings({ theme: state.settings.theme === 'night' ? 'paper' : 'night' }) },
      },
      {
        label: state.settings.sourceMode ? '切换为行内渲染' : '切换为源码模式',
        kbd: '⌘/',
        run: () => { onClose(); void vault.updateSettings({ sourceMode: !state.settings.sourceMode }) },
      },
      {
        label: state.settings.typewriter ? '关闭打字机模式' : '开启打字机模式',
        run: () => { onClose(); void vault.updateSettings({ typewriter: !state.settings.typewriter }) },
      },
      {
        label: state.settings.showPet ? '让墨墨先躲起来' : '请墨墨出来',
        run: () => { onClose(); void vault.updateSettings({ showPet: !state.settings.showPet }) },
      },
      {
        label: 'AI：接着写（当前光标）',
        hint: '让墨墨续写一段，Tab/采纳后插入',
        run: () => { onClose(); window.dispatchEvent(new CustomEvent('inkspire:ai', { detail: { mode: 'continue' } })) },
      },
      {
        label: 'AI：润色选中文字',
        run: () => { onClose(); window.dispatchEvent(new CustomEvent('inkspire:ai', { detail: { mode: 'rewrite' } })) },
      },
      {
        label: 'AI：全文润色并统一排版',
        hint: '保留事实与结构，输出完整 Markdown 供 diff 确认',
        run: () => { onClose(); window.dispatchEvent(new CustomEvent('inkspire:ai', { detail: { mode: 'polish-doc' } })) },
      },
      {
        label: 'AI：解释选中文字',
        run: () => { onClose(); window.dispatchEvent(new CustomEvent('inkspire:ai', { detail: { mode: 'custom', instruction: '用简洁的中文解释选中的文字，指出可能的歧义或问题。' } })) },
      },
      {
        label: 'AI：生成小标题',
        run: () => { onClose(); window.dispatchEvent(new CustomEvent('inkspire:ai', { detail: { mode: 'polish-headings' } })) },
      },
      {
        label: 'AI：把选中内容生成图解',
        run: () => { onClose(); window.dispatchEvent(new CustomEvent('inkspire:ai', { detail: { mode: 'figure' } })) },
      },
      {
        label: 'AI：为整篇文档生成配图提纲',
        run: () => { onClose(); window.dispatchEvent(new CustomEvent('inkspire:ai', { detail: { mode: 'figure-plan' } })) },
      },
      {
        label: 'AI：生成文章封面图',
        run: () => { onClose(); window.dispatchEvent(new CustomEvent('inkspire:ai', { detail: { mode: 'cover' } })) },
      },
      {
        label: 'AI：撤销上次 AI 写入',
        run: () => { onClose(); window.dispatchEvent(new CustomEvent('inkspire:ai', { detail: { mode: 'undo-ai' } })) },
      },
      {
        label: 'AI：打开操作日志与 diff 回放',
        run: () => { onClose(); window.dispatchEvent(new CustomEvent('inkspire:ai', { detail: { mode: 'ai-log' } })) },
      },
      {
        label: '打开 AI 问答（跨库检索）',
        run: () => { onClose(); vault.setSidebar('ai'); },
      },
      {
        label: '打开 AI 动作库（50 个动作）',
        run: () => {
          onClose()
          vault.setSidebar('ai')
          window.setTimeout(() => window.dispatchEvent(new Event('inkspire:ai-actions')), 80)
        },
      },
      { label: '插入表格', hint: '⌘⇧T · 也可输入 /table', run: () => { onClose(); window.dispatchEvent(new Event('inkspire:insert-table')) } },
      { label: '从磁盘刷新（外部修改）', run: () => { onClose(); onReloadFromDisk() } },
      { label: '导出全部数据（JSON 备份）', run: () => { onClose(); void vault.exportBackup() } },
      ...docCommands,
    ]
  }, [state.docs, state.settings, onClose, onOpenDoc, onNewDoc, onOpenImport, onOpenSettings, onOpenVersions, onOpenGraph, onOpenHealth, onReloadFromDisk])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return commands.slice(0, 12)
    const matched = commands.filter((c) => (c.label + (c.hint ?? '')).toLowerCase().includes(needle))
    // ⌘K 同时承担全库检索：命中正文的文档排在命令后面，可直接跳到行
    const hits = vault.search(q, 8).map<Command>((r) => ({
      label: `打开：${r.title}`,
      hint: `第 ${(r.hits[0]?.line ?? 0) + 1} 行 · ${(r.hits[0]?.text ?? '').replace(/\s+/g, ' ').slice(0, 48)}`,
      run: () => {
        onClose()
        onOpenDoc(r.docId, r.hits[0]?.line)
      },
    }))
    const seen = new Set(matched.map((c) => c.label))
    return [...matched, ...hits.filter((h) => !seen.has(h.label))].slice(0, 14)
  }, [q, commands, onClose, onOpenDoc])

  useEffect(() => setIndex(0), [q])

  useEffect(() => {
    const el = listRef.current?.querySelector('.palette-item.on') as HTMLElement | null
    el?.scrollIntoView({ block: 'nearest' })
  }, [index])

  return (
    <div className="modal-mask" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" ref={dialogRef} role="dialog" aria-modal="true" aria-label="命令面板" onKeyDown={(e) => {
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          setIndex((i) => Math.min(filtered.length - 1, i + 1))
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault()
          setIndex((i) => Math.max(0, i - 1))
        }
        if (e.key === 'Enter') {
          e.preventDefault()
          filtered[index]?.run()
        }
      }}>
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="输入命令或文档名…" />
        <div className="palette-list" ref={listRef} role="listbox" aria-label="命令与搜索结果">
          {filtered.map((c, i) => (
            <div
              key={`${c.label}-${i}`}
              className={`palette-item${i === index ? ' on' : ''}`}
              role="option"
              aria-selected={i === index}
              onMouseEnter={() => setIndex(i)}
              onClick={c.run}
            >
              <span>{c.label}</span>
              {c.kbd && <span className="kbd">{c.kbd}</span>}
              {!c.kbd && c.hint && <span className="kbd">{c.hint}</span>}
            </div>
          ))}
          {!filtered.length && <div className="palette-empty">没有匹配的命令</div>}
        </div>
      </div>
    </div>
  )
}
