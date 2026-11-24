import { useMemo, useRef, useState } from 'react'
import { useDialogA11y } from './ui/useDialogA11y'
import { Momo } from './Momo'
import { Icon } from './ui/Icon'
import { countWords, extractWikiLinks, parseFrontMatter } from '../lib/md'
import type { Document } from '../types'

interface Props {
  docs: Document[]
  onOpenDoc: (id: string, line?: number) => void
  onOpenGraph: () => void
  onClose: () => void
}

type IssueKind = 'broken' | 'orphan' | 'empty' | 'duplicate' | 'stale' | 'large'

interface Issue {
  key: string
  kind: IssueKind
  title: string
  detail: string
  docId?: string
  line?: number
}

interface Group {
  kind: IssueKind
  label: string
  hint: string
  items: Issue[]
}

const STALE_DAYS = 90
const LARGE_CHARS = 120_000

function dayStart(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** 本机文档体检：只读扫描，不改任何文件 */
export function HealthModal({ docs, onOpenDoc, onOpenGraph, onClose }: Props) {
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const [open, setOpen] = useState<IssueKind[]>(['broken', 'orphan', 'duplicate', 'empty'])
  useDialogA11y(dialogRef, onClose)

  const groups = useMemo<Group[]>(() => {
    const byName = new Map<string, Document[]>()
    const addName = (name: string, doc: Document) => {
      const key = name.trim().toLowerCase()
      if (!key) return
      const rows = byName.get(key) ?? []
      if (!rows.some((d) => d.id === doc.id)) rows.push(doc)
      byName.set(key, rows)
    }
    for (const doc of docs) {
      addName(doc.title, doc)
      addName(doc.path.replace(/\.md$/i, ''), doc)
      for (const alias of doc.frontMatter.aliases) addName(alias, doc)
    }

    const inbound = new Map<string, number>()
    const outbound = new Map<string, number>()
    const broken: Issue[] = []
    const seenBroken = new Set<string>()
    for (const doc of docs) {
      const body = parseFrontMatter(doc.content).body
      const lines = body.split('\n')
      for (const link of extractWikiLinks(body)) {
        const targets = byName.get(link.target.trim().toLowerCase()) ?? []
        const external = targets.filter((d) => d.id !== doc.id)
        if (external.length) {
          for (const target of external) {
            inbound.set(target.id, (inbound.get(target.id) ?? 0) + 1)
            outbound.set(doc.id, (outbound.get(doc.id) ?? 0) + 1)
          }
          continue
        }
        if (targets.length) continue
        const key = `${doc.id}:${link.target.toLowerCase()}`
        if (seenBroken.has(key)) continue
        seenBroken.add(key)
        const line = Math.max(0, lines.slice(0, link.offset).length - 1)
        broken.push({
          key,
          kind: 'broken',
          title: link.raw,
          detail: `在《${doc.title}》第 ${line + 1} 行，找不到「${link.target}」`,
          docId: doc.id,
          line,
        })
      }
    }

    const orphans: Issue[] = docs
      .filter((doc) => (inbound.get(doc.id) ?? 0) + (outbound.get(doc.id) ?? 0) === 0)
      .map((doc) => ({
        key: `orphan:${doc.id}`,
        kind: 'orphan',
        title: doc.title,
        detail: '没有解析成功的双链指向它，也没有指向别处',
        docId: doc.id,
      }))

    const empty: Issue[] = docs.flatMap((doc) => {
      const body = parseFrontMatter(doc.content).body.trim()
      const words = countWords(body)
      if (words >= 30) return []
      return [
        {
          key: `empty:${doc.id}`,
          kind: 'empty' as const,
          title: doc.title,
          detail: words ? `正文只有 ${words} 字，可能还没展开` : '正文为空，只有标题或元数据',
          docId: doc.id,
        },
      ]
    })

    const titles = new Map<string, Document[]>()
    for (const doc of docs) {
      const key = doc.title.trim().toLowerCase()
      if (!key) continue
      const rows = titles.get(key) ?? []
      rows.push(doc)
      titles.set(key, rows)
    }
    const duplicate: Issue[] = [...titles.entries()]
      .filter(([, rows]) => rows.length > 1)
      .map(([title, rows]) => ({
        key: `duplicate:${title}`,
        kind: 'duplicate',
        title: rows[0].title,
        detail: `${rows.length} 篇同名文档：${rows.map((d) => d.path).join('、')}`,
        docId: rows[0].id,
      }))

    const staleBefore = dayStart(Date.now()) - STALE_DAYS * 86_400_000
    const stale: Issue[] = docs
      .filter((doc) => doc.updatedAt < staleBefore)
      .sort((a, b) => a.updatedAt - b.updatedAt)
      .map((doc) => ({
        key: `stale:${doc.id}`,
        kind: 'stale',
        title: doc.title,
        detail: `最后更新于 ${new Date(doc.updatedAt).toLocaleDateString()}，已超过 ${STALE_DAYS} 天`,
        docId: doc.id,
      }))

    const large: Issue[] = docs
      .filter((doc) => doc.content.length > LARGE_CHARS)
      .sort((a, b) => b.content.length - a.content.length)
      .map((doc) => ({
        key: `large:${doc.id}`,
        kind: 'large',
        title: doc.title,
        detail: `${Math.round(doc.content.length / 1000)} 千字符，建议拆分章节或归档`,
        docId: doc.id,
      }))

    return [
      { kind: 'broken', label: '断链', hint: '链接目标不存在，点击跳到出现位置', items: broken },
      { kind: 'orphan', label: '孤岛文档', hint: '没有任何解析成功的双链进出', items: orphans },
      { kind: 'duplicate', label: '重复标题', hint: '同名文档会让链接指向变得含糊', items: duplicate },
      { kind: 'empty', label: '空 / 短文', hint: '正文少于 30 字', items: empty },
      { kind: 'stale', label: '长期未更新', hint: `超过 ${STALE_DAYS} 天没有修改`, items: stale },
      { kind: 'large', label: '超大文档', hint: `超过 ${LARGE_CHARS.toLocaleString()} 字符`, items: large },
    ]
  }, [docs])

  const counts = new Map(groups.map((g) => [g.kind, g.items.length]))
  const total = groups.reduce((n, g) => n + g.items.length, 0)
  const issueDocs = new Set(groups.flatMap((g) => g.items.map((i) => i.docId)).filter(Boolean)).size
  const toggle = (kind: IssueKind) => {
    setOpen((prev) => (prev.includes(kind) ? prev.filter((k) => k !== kind) : [...prev, kind]))
  }

  const summary: { kind: IssueKind; label: string }[] = [
    { kind: 'broken', label: '断链' },
    { kind: 'orphan', label: '孤岛' },
    { kind: 'duplicate', label: '重名' },
    { kind: 'empty', label: '空/短文' },
    { kind: 'stale', label: '久未更新' },
    { kind: 'large', label: '超大' },
  ]

  return (
    <div className="modal-mask" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal health-modal" ref={dialogRef} role="dialog" aria-modal="true" aria-label="文档体检">
        <div className="modal-head">
          <Momo mood={total ? 'thinking' : 'happy'} className="momo-mini" />
          <h3>文档体检</h3>
          <button className="close" onClick={onClose} aria-label="关闭文档体检">
            <Icon name="close" size={16} />
          </button>
        </div>

        <div className="health-summary">
          <div className="health-score">
            <b>{total}</b>
            <span>个可处理问题</span>
            <em>{issueDocs} 篇文档受影响</em>
          </div>
          <div className="health-badges">
            {summary.map((s) => (
              <button
                key={s.kind}
                type="button"
                className={`health-badge${counts.get(s.kind) ? ' has-issue' : ''}`}
                onClick={() => toggle(s.kind)}
                aria-pressed={open.includes(s.kind)}
              >
                <b>{counts.get(s.kind) ?? 0}</b>
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div className="modal-body health-body">
          {!total && (
            <div className="health-clear">
              <Momo mood="happy" className="big" />
              <b>这个库很健康</b>
              <p>没有发现断链、孤岛、重复标题或明显的空文档。</p>
            </div>
          )}
          {groups.map((group) => {
            const items = group.items
            if (!items.length) return null
            const expanded = open.includes(group.kind)
            return (
              <section key={group.kind} className="health-section">
                <button type="button" className="health-section-head" onClick={() => toggle(group.kind)} aria-expanded={expanded}>
                  <Icon name={expanded ? 'chevronDown' : 'chevronRight'} size={13} />
                  <b>{group.label}</b>
                  <span>{items.length}</span>
                  <em>{group.hint}</em>
                </button>
                {expanded && (
                  <div className="health-list">
                    {items.slice(0, 40).map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        className="health-item"
                        onClick={() => {
                          if (item.docId) {
                            onOpenDoc(item.docId, item.line)
                            onClose()
                          }
                        }}
                        disabled={!item.docId}
                      >
                        <b>{item.title}</b>
                        <span>{item.detail}</span>
                        <Icon name="arrowRight" size={13} />
                      </button>
                    ))}
                    {items.length > 40 && <div className="health-more">还有 {items.length - 40} 条未显示，先处理前面这些。</div>}
                  </div>
                )}
              </section>
            )
          })}
        </div>

        <div className="modal-foot">
          <span>只读扫描，不会自动改文档；孤岛和空文档按需手动处理</span>
          <div className="right">
            <button className="tbtn" onClick={onOpenGraph}>
              <Icon name="globe" size={15} /> 看知识图谱
            </button>
            <button className="tbtn primary" onClick={onClose}>关闭</button>
          </div>
        </div>
      </div>
    </div>
  )
}
