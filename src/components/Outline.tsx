import { useEffect, useMemo, useRef, useState } from 'react'
import { vault, useVault } from '../store'
import { Momo } from './Momo'
import { extractHeadings, extractTags, parseFrontMatter } from '../lib/md'
import { Icon } from './ui/Icon'
import type { ContextSource } from '../types'
import { isTauri } from '../lib/platform'

interface Props {
  onJump: (line: number) => void
  onOpenDoc: (id: string, line?: number) => void
}

const STATUS_LINE: Record<string, [string, string]> = {
  idle: ['墨墨在发呆…', '等你写点什么'],
  writing: ['墨墨认真工作中', '唰唰唰，别打扰~'],
  happy: ['墨墨很开心！', '这段写得漂亮 ✦'],
  thinking: ['墨墨在思考…', '帮你找找关联'],
  surprised: ['墨墨吓了一跳', '刚才发生了什么'],
  sleepy: ['墨墨睡着了', 'Zzz…'],
}

export function Outline({ onJump, onOpenDoc }: Props) {
  const state = useVault()
  const doc = state.docs.find((d) => d.id === state.activeId)
  const rustBlocks = doc ? state.blocksByPath[doc.path] : undefined
  const headings = useMemo(() => {
    if (!doc) return []
    if (isTauri && rustBlocks?.length) {
      return rustBlocks
        .filter((b) => b.kind === 'heading')
        .map((b) => ({ level: b.level, text: b.text, line: Math.max(0, b.line - 1), offset: 0 }))
    }
    return extractHeadings(doc.content)
  }, [doc?.content, rustBlocks])
  const tags = useMemo(() => (doc ? extractTags(doc.content) : []), [doc?.content])
  const [activeLine, setActiveLine] = useState(0)
  const [related, setRelated] = useState<ContextSource[] | null>(null)
  const [relatedBusy, setRelatedBusy] = useState(false)
  const [relatedNote, setRelatedNote] = useState('')
  const listRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const el = listRef.current?.querySelector('.outline-item.active') as HTMLElement | null
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeLine])

  useEffect(() => {
    setRelated(null)
    setRelatedNote('')
  }, [doc?.id])

  const findRelated = async () => {
    if (!doc || relatedBusy) return
    if (!state.settings.ai.enabled) {
      setRelatedNote('先在设置里启用 AI，才能按语义找相关笔记')
      return
    }
    setRelatedBusy(true)
    setRelatedNote('')
    const body = parseFrontMatter(doc.content).body
    const result = await vault.findContextSmart(`${doc.title}\n${body.slice(0, 700)}`, doc.id, 4)
    setRelated(result.sources)
    setRelatedNote(result.note ?? (result.mode === 'semantic' ? '按语义相似度召回' : '按关键词召回'))
    setRelatedBusy(false)
  }

  const status = STATUS_LINE[state.mood] ?? STATUS_LINE.idle

  return (
    <aside className="outline">
      <div className="outline-head">
        <Momo mood="thinking" className="momo-mini" />
        本篇大纲 · {headings.length}
      </div>
      <div className="outline-list" ref={listRef}>
        {headings.length === 0 && <div className="empty-hint">{doc ? '还没有标题。写一个 # 标题试试。' : '未打开文档'}</div>}
        {headings.map((h, i) => (
          <button
            key={`${h.line}-${i}`}
            className={`outline-item lv${h.level}${activeLine === i ? ' active' : ''}`}
            onClick={() => {
              setActiveLine(i)
              onJump(h.line)
            }}
            data-tip={h.text}
          >
            {h.text}
          </button>
        ))}
      </div>
      <div className="outline-related">
        <button type="button" className="outline-related-btn" onClick={() => void findRelated()} disabled={relatedBusy || !doc}>
          <Icon name="sparkles" size={12} />
          {relatedBusy ? '正在找相关…' : '相关笔记'}
        </button>
        {relatedNote && <div className="outline-related-note">{relatedNote}</div>}
        {related?.length === 0 && <div className="outline-related-note">没有找到相关笔记</div>}
        {related?.map((item) => (
          <button
            key={item.id}
            type="button"
            className="outline-related-item"
            onClick={() => onOpenDoc(item.id, item.line)}
            title={item.excerpt || item.title}
          >
            <span>{item.title}</span>
            <small>{Math.round(item.score * 100)}%</small>
          </button>
        ))}
      </div>

      <div className="outline-stats">
        {doc ? (
          <>
            <div>
              <b>{doc.wordCount.toLocaleString()}</b> 字 · <b>{headings.length}</b> 标题
            </div>
            <div>
              {tags.length ? tags.map((t) => `#${t}`).join(' ') : '暂无标签'}
            </div>
            <div style={{ marginTop: 4, opacity: 0.7 }}>{doc.importMeta ? `导入自 ${doc.importMeta.importer.toUpperCase()} · 质量 ${(doc.importMeta.quality * 100).toFixed(0)}%` : doc.path}</div>
          </>
        ) : (
          <div>打开一篇文档开始</div>
        )}
      </div>
      <div className="outline-status">
        <Momo mood={state.mood} className="momo-mini" />
        <div>
          <div className="st">{status[0]}</div>
          <div className="ss">{state.petLine ?? status[1]}</div>
        </div>
      </div>
    </aside>
  )
}
