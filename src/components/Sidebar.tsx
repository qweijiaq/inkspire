import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { vault, useVault } from '../store'
import { isTauri } from '../lib/platform'
import { Momo } from './Momo'
import { extractTags, extractWikiLinks, formatTime } from '../lib/md'
import type { Document, SearchResult, SidebarTab } from '../types'
import { confirmDialog } from '../lib/dialog'
import { LearningPanel } from './LearningPanel'
import { Icon, type IconName } from './ui/Icon'
import { useDialogA11y } from './ui/useDialogA11y'
import { Select } from './ui/Select'

interface Props {
  onOpenDoc: (id: string, line?: number) => void
  onNewDoc: () => void
  onOpenImport: () => void
  onOpenGraph: () => void
  onRenameFolder: (path: string, name: string) => Promise<void>
  /** 文件树操作前先让编辑器落盘，避免拖动/改名丢掉最后一段输入 */
  onFlush?: () => Promise<unknown>
}

type DropHint =
  | { kind: 'doc'; path: string; pos: 'before' | 'after' }
  | { kind: 'folder'; path: string }
  | null

interface FolderNode {
  name: string
  path: string
  docs: Document[]
  folders: Map<string, FolderNode>
}

function buildTree(docs: Document[], folders: string[] = []): FolderNode {
  const root: FolderNode = { name: '', path: '', docs: [], folders: new Map() }
  const ensure = (path: string) => {
    let node = root
    for (const part of path.split('/').filter(Boolean)) {
      if (!node.folders.has(part)) node.folders.set(part, { name: part, path: node.path ? `${node.path}/${part}` : part, docs: [], folders: new Map() })
      node = node.folders.get(part)!
    }
  }
  folders.forEach(ensure)
  for (const doc of docs) {
    const parts = doc.path.split('/')
    const fileName = parts.pop() ?? doc.path
    let node = root
    for (const part of parts) {
      if (!node.folders.has(part)) node.folders.set(part, { name: part, path: node.path ? `${node.path}/${part}` : part, docs: [], folders: new Map() })
      node = node.folders.get(part)!
    }
    node.docs.push({ ...doc, title: doc.title || fileName })
  }
  return root
}

function highlight(text: string, start: number, length: number) {
  if (!length) return text
  const s = Math.max(0, start - 40)
  const prefix = s > 0 ? '…' : ''
  const body = text.slice(s, s + 180)
  const rel = Math.max(0, start - s)
  return (
    <>
      {prefix}
      {body.slice(0, rel)}
      <mark>{body.slice(rel, rel + length)}</mark>
      {body.slice(rel + length)}
    </>
  )
}

export function Sidebar({ onOpenDoc, onNewDoc, onOpenImport, onOpenGraph, onRenameFolder, onFlush }: Props) {
  const state = useVault()
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [renaming, setRenaming] = useState<string | null>(null)
  const [folderPrompt, setFolderPrompt] = useState<{ parent: string } | null>(null)
  const [folderName, setFolderName] = useState('新建文件夹')
  const [folderRename, setFolderRename] = useState<{ path: string; value: string } | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [tag, setTag] = useState<string | null>(null)
  const [remoteResults, setRemoteResults] = useState<SearchResult[] | null>(null)
  const [searchMode, setSearchMode] = useState<'keyword' | 'semantic'>('keyword')
  const [semanticResults, setSemanticResults] = useState<SearchResult[] | null>(null)
  const [semanticBusy, setSemanticBusy] = useState(false)
  const [semanticMessage, setSemanticMessage] = useState('')
  const [moving, setMoving] = useState<Document | null>(null)
  const [moveTarget, setMoveTarget] = useState('')
  const [dragging, setDragging] = useState<string | null>(null)
  const [dropHint, setDropHint] = useState<DropHint>(null)
  const folderRef = useRef<HTMLDivElement | null>(null)
  const moveRef = useRef<HTMLDivElement | null>(null)
  const folderRenameRef = useRef<HTMLDivElement | null>(null)
  useDialogA11y(folderRef, () => setFolderPrompt(null), !!folderPrompt)
  useDialogA11y(moveRef, () => setMoving(null), !!moving)
  useDialogA11y(folderRenameRef, () => setFolderRename(null), !!folderRename)

  const tabs: { id: SidebarTab; label: string; icon: IconName }[] = [
    { id: 'files', label: '文件', icon: 'file' },
    { id: 'search', label: '搜索', icon: 'search' },
    { id: 'tags', label: '标签', icon: 'hash' },
    { id: 'links', label: '链接', icon: 'link' },
    { id: 'learn', label: '共学', icon: 'book' },
  ]

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), 180)
    return () => window.clearTimeout(timer)
  }, [query])

  const tree = useMemo(() => buildTree(state.docs, state.folders), [state.docs, state.folders])
  const favorites = state.docs.filter((d) => d.favorite)
  const recent = state.recent.map((id) => state.docs.find((d) => d.id === id)).filter(Boolean) as Document[]
  const localResults: SearchResult[] = useMemo(
    () => (debouncedQuery.trim() ? vault.search(debouncedQuery) : []),
    [debouncedQuery, state.docs],
  )
  useEffect(() => {
    setRemoteResults(null)
    if (!debouncedQuery.trim() || !isTauri) return
    let cancelled = false
    vault
      .searchRemote(debouncedQuery)
      .then((r) => !cancelled && setRemoteResults(r))
      .catch(() => !cancelled && setRemoteResults(null))
    return () => {
      cancelled = true
    }
  }, [debouncedQuery, state.docs])
  useEffect(() => {
    if (searchMode !== 'semantic') {
      setSemanticResults(null)
      setSemanticMessage('')
      return
    }
    if (!debouncedQuery.trim()) {
      setSemanticResults(null)
      setSemanticMessage('')
      return
    }
    let cancelled = false
    setSemanticBusy(true)
    setSemanticMessage('正在理解问题…')
    vault
      .searchSemantic(debouncedQuery, (done, total) => {
        if (!cancelled) setSemanticMessage(total ? `建立本机语义索引 ${done}/${total}` : '正在理解问题…')
      })
      .then((rows) => {
        if (cancelled) return
        setSemanticResults(rows)
        setSemanticMessage(rows.length ? `语义命中 ${rows.length} 篇` : '没有相近的文档')
      })
      .catch((e: any) => {
        if (cancelled) return
        setSemanticResults([])
        setSemanticMessage(e?.message ?? String(e))
      })
      .finally(() => {
        if (!cancelled) setSemanticBusy(false)
      })
    return () => {
      cancelled = true
    }
  }, [searchMode, debouncedQuery])

  const results: SearchResult[] = searchMode === 'semantic' ? semanticResults ?? [] : remoteResults ?? localResults
  const tags = useMemo(() => {
    const map = new Map<string, { count: number; docs: string[] }>()
    for (const d of state.docs) {
      for (const t of extractTags(d.content)) {
        const cur = map.get(t) ?? { count: 0, docs: [] }
        cur.count++
        cur.docs.push(d.id)
        map.set(t, cur)
      }
    }
    return [...map.entries()].sort((a, b) => b[1].count - a[1].count)
  }, [state.docs])

  const active = state.docs.find((d) => d.id === state.activeId) ?? null
  const outgoing = useMemo(() => (active ? extractWikiLinks(active.content) : []), [active])
  const mentions = useMemo(() => (active ? vault.mentions(active.title, active.id) : []), [active, state.docs])
  const backlinks = useMemo(() => {
    if (!active) return []
    const seen = new Set<string>()
    return vault.backlinks(active.title).filter((b) => (seen.has(b.docId) ? false : (seen.add(b.docId), true)))
  }, [active, state.docs])

const moveFolderOptions = [
  { value: '', label: '根目录' },
  ...state.folders
    .filter((folder) => !(moving?.path ?? '').startsWith(`${folder}/`))
    .map((folder) => ({ value: folder, label: folder })),
]

  const toggleFolder = (path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      next.has(path) ? next.delete(path) : next.add(path)
      return next
    })
  }

  const startRename = (doc: Document) => {
    setRenaming(doc.id)
    setRenameValue(doc.path)
  }

  const commitRename = async (doc: Document) => {
    if (renameValue.trim() && renameValue.trim() !== doc.path) {
      await onFlush?.()
      await vault.rename(doc.id, renameValue.trim())
    }
    setRenaming(null)
  }

  const openOrCreateLink = async (raw: string) => {
    const target = state.docs.find((d) => d.title.toLowerCase() === raw.trim().toLowerCase())
    if (target) {
      onOpenDoc(target.id)
      return
    }
    const title = raw.trim()
    if (!title) return
    const name = title.replace(/[\\/:*?"<>|]/g, ' ').replace(/^\/+|\/+$/g, '') || '未命名'
    const doc = await vault.createDoc({
      title,
      path: `${name}.md`,
      content: `# ${title}\n\n> 这是一条尚未存在的链接，现在它有了自己的位置。\n`,
    })
    onOpenDoc(doc.id)
  }

  const newDocInFolder = async (folder: string) => {
    let name = '未命名'
    let n = 2
    while (state.docs.some((d) => d.path === `${folder}/${name}.md`)) name = `未命名 ${n++}`
    const doc = await vault.createDoc({ path: `${folder}/${name}.md` })
    onOpenDoc(doc.id)
  }

  const createFolder = async () => {
    if (!folderPrompt) return
    const path = await vault.createFolder(folderPrompt.parent, folderName)
    if (path) {
      setFolderPrompt(null)
      setFolderName('新建文件夹')
    }
  }

  const commitMove = async () => {
    if (!moving) return
    const name = moving.path.split('/').pop() ?? moving.path
    const next = moveTarget ? `${moveTarget}/${name}` : name
    if (next !== moving.path) {
      await onFlush?.()
      await vault.rename(moving.id, next)
    }
    setMoving(null)
  }

  const renderDoc = (doc: Document, prefix = '', sortable = true) => {
    const isActive = doc.id === state.activeId
    if (renaming === doc.id) {
      return (
        <div className="tree-row" key={`${prefix}${doc.id}`}>
          <Icon name="file" size={14} className="fic" />
          <input
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={() => void commitRename(doc)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void commitRename(doc)
              if (e.key === 'Escape') setRenaming(null)
            }}
            style={{ flex: 1, border: '1.5px solid var(--brand)', borderRadius: 6, height: 24, padding: '0 6px', fontSize: 12, background: 'var(--card)', outline: 'none' }}
          />
        </div>
      )
    }
    return (
      <div
        className={`tree-row${isActive ? ' active' : ''}${dropHint?.kind === 'doc' && dropHint.path === doc.path ? ` drop-${dropHint.pos}` : ''}${dragging === doc.id ? ' dragging' : ''}`}
        key={`${prefix}${doc.id}`}
        role="treeitem"
        aria-selected={isActive}
        tabIndex={0}
        draggable={sortable}
        onClick={() => onOpenDoc(doc.id)}
        onDoubleClick={() => startRename(doc)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onOpenDoc(doc.id)
          }
        }}
        onDragStart={(e) => {
          if (!sortable) return
          e.stopPropagation()
          setDragging(doc.id)
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData('text/plain', doc.id)
        }}
        onDragEnd={() => {
          setDragging(null)
          setDropHint(null)
        }}
        onDragOver={(e) => {
          if (!dragging || dragging === doc.id) return
          e.preventDefault()
          e.stopPropagation()
          e.dataTransfer.dropEffect = 'move'
          const rect = e.currentTarget.getBoundingClientRect()
          setDropHint({ kind: 'doc', path: doc.path, pos: e.clientY > rect.top + rect.height / 2 ? 'after' : 'before' })
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropHint(null)
        }}
        onDrop={(e) => {
          if (!dragging) return
          e.preventDefault()
          e.stopPropagation()
          const rect = e.currentTarget.getBoundingClientRect()
          const after = e.clientY > rect.top + rect.height / 2
          const id = dragging
          setDragging(null)
          setDropHint(null)
          void (async () => {
            await onFlush?.()
            await vault.reorderDoc(id, doc.id, after)
          })()
        }}
        data-tip={doc.path}
      >
        <Icon name="file" size={16} className="fic" />
        <span className="fname">{doc.title}</span>
        <span className="row-sub">{formatTime(doc.updatedAt)}</span>
        <span className="row-actions" onClick={(e) => e.stopPropagation()}>
          <button className="icon-btn" aria-label={doc.favorite ? '取消收藏' : '收藏'} data-tip={doc.favorite ? '取消收藏' : '收藏'} onClick={() => void vault.toggleFavorite(doc.id)}>
            <Icon name={doc.favorite ? 'starFilled' : 'star'} size={14} />
          </button>
          <button className="icon-btn" aria-label="重命名" data-tip="重命名" onClick={() => startRename(doc)}>
            <Icon name="edit" size={14} />
          </button>
          <button
            className="icon-btn"
            aria-label="移动到文件夹"
            data-tip="移动到文件夹"
            onClick={() => {
              setMoveTarget(doc.path.includes('/') ? doc.path.split('/').slice(0, -1).join('/') : '')
              setMoving(doc)
            }}
          >
            <Icon name="folder" size={14} />
          </button>
          <button
            className="icon-btn"
            aria-label="删除"
            data-tip="删除"
            onClick={async () => {
              const ok = await confirmDialog({
                title: '删除文档',
                message: `确定删除《${doc.title}》吗？${isTauri ? '文件会从磁盘上移除。' : '此操作不可撤销。'}`,
                confirmText: '删除',
                danger: true,
              })
              if (ok) void vault.remove(doc.id)
            }}
          >
            <Icon name="trash" size={14} />
          </button>
        </span>
      </div>
    )
  }

  const renderNode = (node: FolderNode, depth = 0) => {
    const folders = [...node.folders.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh'))
    const docs = [...node.docs].sort((a, b) => {
      const oa = state.treeOrder[a.path]
      const ob = state.treeOrder[b.path]
      if (oa !== undefined && ob !== undefined) return oa - ob
      if (oa !== undefined) return -1
      if (ob !== undefined) return 1
      return b.updatedAt - a.updatedAt
    })
    return (
      <>
        {folders.map((f) => {
          const isCollapsed = collapsed.has(f.path)
          return (
            <div key={f.path}>
              <div
                className={`tree-row folder-row${dropHint?.kind === 'folder' && dropHint.path === f.path ? ' drop-inside' : ''}`}
                role="treeitem"
                aria-expanded={!isCollapsed}
                tabIndex={0}
                onClick={() => toggleFolder(f.path)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    toggleFolder(f.path)
                  }
                }}
                onDragOver={(e) => {
                  if (!dragging) return
                  e.preventDefault()
                  e.stopPropagation()
                  e.dataTransfer.dropEffect = 'move'
                  setDropHint({ kind: 'folder', path: f.path })
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropHint(null)
                }}
                onDrop={(e) => {
                  if (!dragging) return
                  e.preventDefault()
                  e.stopPropagation()
                  const id = dragging
                  setDragging(null)
                  setDropHint(null)
                  void (async () => {
                    await onFlush?.()
                    await vault.moveDocToFolder(id, f.path)
                  })()
                }}
              >
                <span className="fic"><Icon name={isCollapsed ? 'chevronRight' : 'chevronDown'} size={14} /></span>
                <span className="fname"><Icon name="folder" size={13} /> {f.name}</span>
                <span className="folder-actions" onClick={(e) => e.stopPropagation()}>
                  <button type="button" aria-label="在此文件夹新建文档" data-tip="在此文件夹新建文档" onClick={() => void newDocInFolder(f.path)}>
                    <Icon name="plus" size={14} />
                  </button>
                  <button
                    type="button"
                    aria-label="新建子文件夹"
                    data-tip="新建子文件夹"
                    onClick={() => {
                      setFolderName('新建文件夹')
                      setFolderPrompt({ parent: f.path })
                    }}
                  >
                    <Icon name="folderPlus" size={14} />
                  </button>
                  <button
                    type="button"
                    aria-label="重命名文件夹"
                    data-tip="重命名文件夹"
                    onClick={() => {
                      setFolderRename({ path: f.path, value: f.name })
                    }}
                  >
                    <Icon name="edit" size={14} />
                  </button>
                </span>
              </div>
              {!isCollapsed && <div className="folder-children">{renderNode(f, depth + 1)}</div>}
            </div>
          )
        })}
        {docs.map((d) => renderDoc(d))}
      </>
    )
  }

  return (
    <aside className="sidebar">
      <div className="side-tabs">
        {tabs.map((t) => (
          <button
            key={t.id}
            className={`side-tab${state.sidebar === t.id ? ' active' : ''}`}
            aria-pressed={state.sidebar === t.id}
            onClick={() => vault.setSidebar(t.id)}
          >
            <span className="side-tab-label">{t.label}</span>
          </button>
        ))}
      </div>

      <div className="side-body">
        {state.sidebar === 'files' && (
          <>
            <div className="side-section-title">
              <span>文件树</span>
              <span style={{ display: 'flex', gap: 8 }}>
                <button onClick={onNewDoc}><Icon name="plus" size={13} /> 新建</button>
                <button onClick={() => { setFolderName('新建文件夹'); setFolderPrompt({ parent: '' }) }}><Icon name="folderPlus" size={13} /> 文件夹</button>
                <button onClick={onOpenImport}><Icon name="download" size={13} /> 导入</button>
              </span>
            </div>
            {favorites.length > 0 && (
              <>
                <div className="side-section-title" style={{ paddingTop: 2 }}>
                  收藏
                </div>
                {favorites.map((d) => renderDoc(d, 'fav-', false))}
              </>
            )}
            {recent.length > 1 && (
              <>
                <div className="side-section-title" style={{ paddingTop: 2 }}>
                  最近打开
                </div>
                <div className="recent-chips">
                  {recent.slice(0, 5).map((d) => (
                    <button key={`recent-chip-${d.id}`} className={`recent-chip${d.id === state.activeId ? ' on' : ''}`} onClick={() => onOpenDoc(d.id)} data-tip={d.path}>
                      {d.title}
                    </button>
                  ))}
                </div>
              </>
            )}
            <div
              className={`side-section-title${dropHint?.kind === 'folder' && dropHint.path === '' ? ' drop-root' : ''}`}
              style={{ paddingTop: 2 }}
              onDragOver={(e) => {
                if (!dragging) return
                e.preventDefault()
                e.stopPropagation()
                e.dataTransfer.dropEffect = 'move'
                setDropHint({ kind: 'folder', path: '' })
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropHint(null)
              }}
              onDrop={(e) => {
                if (!dragging) return
                e.preventDefault()
                e.stopPropagation()
                const id = dragging
                setDragging(null)
                setDropHint(null)
                void (async () => {
                  await onFlush?.()
                  await vault.moveDocToFolder(id, '')
                })()
              }}
            >
              全部文档 <span style={{ fontWeight: 600 }}>{state.docs.length}</span>
            </div>
            {state.docs.length ? renderNode(tree) : <div className="empty-hint">还没有文档，点上面的「新建」或拖个文件进来。</div>}
          </>
        )}

        {state.sidebar === 'search' && (
          <>
            <div className="search-box">
              <span style={{ color: 'var(--ink-faint)' }}><Icon name="search" size={14} /></span>
              <input
                autoFocus
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  vault.setSearchQuery(e.target.value)
                }}
                placeholder="搜索全部文档…"
              />
              {query && <button aria-label="清除搜索" onClick={() => setQuery('')} style={{ color: 'var(--ink-faint)' }}><Icon name="close" size={13} /></button>}
            </div>
            <div className="search-mode" role="group" aria-label="搜索模式">
              <button type="button" className={searchMode === 'keyword' ? 'on' : ''} aria-pressed={searchMode === 'keyword'} onClick={() => setSearchMode('keyword')}>
                关键词
              </button>
              <button type="button" className={searchMode === 'semantic' ? 'on' : ''} aria-pressed={searchMode === 'semantic'} onClick={() => setSearchMode('semantic')}>
                语义
              </button>
              <span>{searchMode === 'semantic' ? '调用 embedding，首次会建立本机索引' : '标题 / 正文 / 中文二元组'}</span>
            </div>
            {!query && <div className="empty-hint">输入关键词，支持中文、多词匹配与长句检索；切到「语义」可用自然语言找相近笔记。</div>}
            {query && searchMode === 'semantic' && semanticMessage && (
              <div className={`search-semantic-state${semanticBusy ? ' busy' : ''}`}>{semanticMessage}</div>
            )}
            {query && !(searchMode === 'semantic' && (semanticBusy || semanticMessage)) && results.length === 0 && <div className="empty-hint">没有找到「{query}」</div>}
            {results.map((r) => (
              <div
                key={r.docId}
                className="search-result"
                role="button"
                tabIndex={0}
                onClick={() => onOpenDoc(r.docId, r.hits[0]?.line)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onOpenDoc(r.docId, r.hits[0]?.line)
                  }
                }}
              >
                <div className="sr-title">
                  <span>{r.title}</span>
                  <em>{r.hits.length} 处</em>
                </div>
                <div className="sr-path">{r.path}</div>
                {r.hits.slice(0, 3).map((h, i) => (
                  <div className="sr-hit" key={i}>
                    {highlight(h.text, h.start, h.length)}
                  </div>
                ))}
              </div>
            ))}
          </>
        )}

        {state.sidebar === 'tags' && (
          <>
            <div className="side-section-title">全部标签</div>
            {tags.length === 0 && <div className="empty-hint">还没有标签。在正文里写 #tags 就会自动收集。</div>}
            {tags.map(([name, info]) => (
              <div
                key={name}
                className={`tag-item${tag === name ? ' active' : ''}`}
                role="button"
                tabIndex={0}
                onClick={() => setTag(tag === name ? null : name)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    setTag(tag === name ? null : name)
                  }
                }}
              >
                <span className="tag-chip">#{name}</span>
                <span className="tag-count">{info.count} 篇</span>
              </div>
            ))}
            {tag && (
              <>
                <div className="side-section-title" style={{ paddingTop: 12 }}>
                  #{tag} 的文档
                </div>
                {state.docs.filter((d) => extractTags(d.content).includes(tag)).map((d) => renderDoc(d, 'tag-'))}
              </>
            )}
          </>
        )}

        {state.sidebar === 'learn' && <LearningPanel onOpenDoc={onOpenDoc} />}

        {state.sidebar === 'links' && (
          <>
            {!active && <div className="empty-hint">先打开一篇文档。</div>}
            {active && (
              <>
                <div className="side-section-title">
                  <span>反向链接 · {backlinks.length}</span>
                  <button type="button" onClick={onOpenGraph} data-tip="打开知识图谱">
                    <Icon name="link" size={13} /> 图谱
                  </button>
                </div>
                {backlinks.length === 0 && <div className="empty-hint" style={{ padding: '8px 10px' }}>还没有文档链接到《{active.title}》。</div>}
                {backlinks.map((b) => {
                  const d = state.docs.find((x) => x.id === b.docId)
                  return (
                    <div
                      key={b.docId}
                      className="link-card"
                      role="button"
                      tabIndex={0}
                      onClick={() => onOpenDoc(b.docId)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          onOpenDoc(b.docId)
                        }
                      }}
                    >
                      <div className="lc-title">
                        <span>{b.title}</span>
                        <span>{b.count} 处</span>
                      </div>
                      <div className="lc-preview">{d?.preview}</div>
                    </div>
                  )
                })}
                <div className="side-section-title">未链接提及 · {mentions.length}</div>
                {mentions.length === 0 && <div className="empty-hint" style={{ padding: '6px 10px' }}>没有发现正文里提到《{active.title}》但未加双链的地方。</div>}
                {mentions.map((m, i) => (
                  <div
                      key={`${m.docId}-${i}`}
                      className="link-card"
                      role="button"
                      tabIndex={0}
                      onClick={() => onOpenDoc(m.docId, m.line)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          onOpenDoc(m.docId, m.line)
                        }
                      }}
                    >
                    <div className="lc-title">
                      <span>{m.title}</span>
                      <span>L{m.line + 1}</span>
                    </div>
                    <div className="lc-preview">{m.excerpt}</div>
                  </div>
                ))}

                <div className="side-section-title">出链 · {outgoing.length}</div>
                {outgoing.map((l, i) => {
                  const target = state.docs.find((d) => d.title.toLowerCase() === l.target.toLowerCase())
                  return (
                    <div
                      key={`${l.target}-${i}`}
                      className="link-card"
                      role="button"
                      tabIndex={0}
                      onClick={() => void openOrCreateLink(l.target)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          void openOrCreateLink(l.target)
                        }
                      }}
                    >
                      <div className="lc-title">
                        <span>{target ? target.title : `[[${l.target}]]`}</span>
                        <span>{target ? '已解析' : '未解析'}</span>
                      </div>
                      {l.alias && <div className="lc-preview">别名：{l.alias}</div>}
                    </div>
                  )
                })}
              </>
            )}
          </>
        )}
      </div>

      <div className="side-foot">
        <Momo mood={state.mood} className="momo-mini" />
        <span>墨墨陪你写了 <b>{state.docs.reduce((n, d) => n + d.wordCount, 0).toLocaleString()}</b> 字</span>
      </div>

      {moving && createPortal(
        <div className="folder-prompt-mask" onMouseDown={(e) => e.target === e.currentTarget && setMoving(null)}>
          <div className="folder-prompt" role="dialog" aria-modal="true" aria-label="移动文档" ref={moveRef}>
            <h4>移动文档</h4>
            <p>《{moving.title}》将被移动到所选文件夹，正文与双链标题不变。</p>
            <Select value={moveTarget} onChange={setMoveTarget} options={moveFolderOptions} ariaLabel="目标文件夹" />
            <div className="folder-prompt-actions">
              <button className="tbtn" type="button" onClick={() => setMoving(null)}>取消</button>
              <button className="tbtn primary" type="button" onClick={() => void commitMove()}>移动</button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {folderRename && createPortal(
        <div className="folder-prompt-mask" onMouseDown={(e) => e.target === e.currentTarget && setFolderRename(null)}>
          <div className="folder-prompt" role="dialog" aria-modal="true" aria-label="重命名文件夹" ref={folderRenameRef}>
            <h4>重命名文件夹</h4>
            <p>会连同文件夹内的所有文档一起改名，双链标题不变。</p>
            <input
              autoFocus
              value={folderRename.value}
              onChange={(e) => setFolderRename({ ...folderRename, value: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const next = folderRename.value.trim()
                  if (next) {
                    void onRenameFolder(folderRename.path, next)
                    setFolderRename(null)
                  }
                }
                if (e.key === 'Escape') setFolderRename(null)
              }}
              aria-label="文件夹新名称"
            />
            <div className="folder-prompt-actions">
              <button className="tbtn" type="button" onClick={() => setFolderRename(null)}>取消</button>
              <button
                className="tbtn primary"
                type="button"
                disabled={!folderRename.value.trim()}
                onClick={() => {
                  void onRenameFolder(folderRename.path, folderRename.value.trim())
                  setFolderRename(null)
                }}
              >
                重命名
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {folderPrompt && createPortal(
        <div className="folder-prompt-mask" onMouseDown={(e) => e.target === e.currentTarget && setFolderPrompt(null)}>
          <div className="folder-prompt" role="dialog" aria-modal="true" aria-label="新建文件夹" ref={folderRef}>
            <h4>新建文件夹</h4>
            <p>{folderPrompt.parent ? `位置：${folderPrompt.parent}` : '位置：根目录'}</p>
            <input
              autoFocus
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void createFolder()
                if (e.key === 'Escape') setFolderPrompt(null)
              }}
              aria-label="文件夹名称"
            />
            <div className="folder-prompt-actions">
              <button className="tbtn" type="button" onClick={() => setFolderPrompt(null)}>取消</button>
              <button className="tbtn primary" type="button" onClick={() => void createFolder()}>创建</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </aside>
  )
}
