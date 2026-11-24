import { useMemo, useRef, useState } from 'react'
import { useDialogA11y } from './ui/useDialogA11y'
import { Momo } from './Momo'
import { Icon } from './ui/Icon'
import { extractWikiLinks } from '../lib/md'
import type { Document } from '../types'

interface Props {
  docs: Document[]
  onOpenDoc: (id: string) => void
  onClose: () => void
}

interface Node {
  id: string
  title: string
  degree: number
  x: number
  y: number
  r: number
}

/**
 * 知识图谱：只看双链形成的真实关系，不引入额外图数据库。
 * 节点按连接度排在外圈/内圈，孤立文档也能一眼看到。
 */
export function GraphModal({ docs, onOpenDoc, onClose }: Props) {
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const [q, setQ] = useState('')
  useDialogA11y(dialogRef, onClose)

  const graph = useMemo(() => {
    const byTitle = new Map<string, Document>()
    for (const doc of docs) {
      byTitle.set(doc.title.toLowerCase(), doc)
      byTitle.set(doc.path.replace(/\.md$/i, '').toLowerCase(), doc)
      for (const alias of doc.frontMatter.aliases) byTitle.set(alias.toLowerCase(), doc)
    }
    const edgeSet = new Set<string>()
    const edges: { from: string; to: string }[] = []
    const degree = new Map<string, number>()
    for (const doc of docs) {
      for (const link of extractWikiLinks(doc.content)) {
        const target = byTitle.get(link.target.toLowerCase())
        if (!target || target.id === doc.id) continue
        const key = [doc.id, target.id].sort().join('::')
        if (edgeSet.has(key)) continue
        edgeSet.add(key)
        edges.push({ from: doc.id, to: target.id })
        degree.set(doc.id, (degree.get(doc.id) ?? 0) + 1)
        degree.set(target.id, (degree.get(target.id) ?? 0) + 1)
      }
    }
    const sorted = [...docs].sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0))
    const shown = sorted.slice(0, 90)
    const centerX = 460
    const centerY = 280
    const hasHub = (degree.get(shown[0]?.id ?? '') ?? 0) > 0 && shown.length > 2
    const ringNodes = hasHub ? shown.slice(1) : shown
    const rx = Math.min(350, 110 + ringNodes.length * 16)
    const ry = Math.min(215, 80 + ringNodes.length * 10)
    const nodes: Node[] = shown.map((doc, i) => {
      const d = degree.get(doc.id) ?? 0
      if (hasHub && i === 0) {
        return { id: doc.id, title: doc.title, degree: d, x: centerX, y: centerY, r: 7 + Math.min(15, d * 2.4) }
      }
      const ringIndex = hasHub ? i - 1 : i
      const angle = (ringIndex / Math.max(1, ringNodes.length)) * Math.PI * 2 - Math.PI / 2
      const ring = d > 0 ? 1 : 1.12
      return {
        id: doc.id,
        title: doc.title,
        degree: d,
        x: centerX + Math.cos(angle) * rx * ring,
        y: centerY + Math.sin(angle) * ry * ring,
        r: 5 + Math.min(14, d * 2.2),
      }
    })
    return { nodes, edges, links: edges.length, isolated: nodes.filter((n) => n.degree === 0).length, hidden: docs.length - shown.length }
  }, [docs])

  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]))
  const needle = q.trim().toLowerCase()
  const matched = new Set(graph.nodes.filter((n) => n.title.toLowerCase().includes(needle)).map((n) => n.id))

  return (
    <div className="modal-mask" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal graph-modal" ref={dialogRef} role="dialog" aria-modal="true" aria-label="知识图谱">
        <div className="modal-head">
          <Momo mood="thinking" className="momo-mini" />
          <h3>知识图谱</h3>
          <button className="close" onClick={onClose} aria-label="关闭知识图谱">
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="graph-bar">
          <div className="search-box">
            <Icon name="search" size={14} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索节点…" aria-label="搜索图谱节点" />
          </div>
          <span className="graph-stat"><b>{docs.length}</b> 篇 · <b>{graph.links}</b> 条双链 · <b>{graph.isolated}</b> 个孤岛</span>
        </div>
        <div className="graph-canvas">
          <svg viewBox="0 0 920 560" role="img" aria-label={`知识图谱，${docs.length} 篇文档，${graph.links} 条链接`}>
            {graph.edges.map((edge, i) => {
              const a = nodeById.get(edge.from)
              const b = nodeById.get(edge.to)
              if (!a || !b) return null
              const dim = needle && !matched.has(a.id) && !matched.has(b.id)
              return (
                <line
                  key={i}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  className={`graph-edge${dim ? ' dim' : ''}`}
                />
              )
            })}
            {graph.nodes.map((node) => {
              const dim = needle && !matched.has(node.id)
              return (
                <g
                  key={node.id}
                  className={`graph-node${dim ? ' dim' : ''}${node.degree === 0 ? ' isolated' : ''}`}
                  transform={`translate(${node.x} ${node.y})`}
                  onClick={() => {
                    onOpenDoc(node.id)
                    onClose()
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      onOpenDoc(node.id)
                      onClose()
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  aria-label={`${node.title}，${node.degree} 条连接`}
                  data-tip={`${node.title} · ${node.degree} 条连接`}
                >
                  <circle r={node.r} />
                  {(node.degree > 0 || node.r > 7) && <text y={node.r + 13}>{node.title.slice(0, 14)}</text>}
                </g>
              )
            })}
          </svg>
        </div>
        <div className="modal-foot">
          <span>{graph.hidden > 0 ? `仅显示连接度最高的 90 篇，还有 ${graph.hidden} 篇未画出` : '点击节点打开文档；孤岛节点没有双链连接'}</span>
          <div className="right">
            <button className="tbtn" onClick={onClose}>关闭</button>
          </div>
        </div>
      </div>
    </div>
  )
}
