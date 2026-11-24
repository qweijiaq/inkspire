import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { vault, useVault } from './store'
import { TopBar } from './components/TopBar'
import { Sidebar } from './components/Sidebar'
import { Outline } from './components/Outline'
import { EditorPane, type EditorHandle } from './components/EditorPane'
import { Pet } from './components/Pet'
import { SettingsModal } from './components/SettingsModal'
import { ImportModal } from './components/ImportModal'
import { VersionsModal } from './components/VersionsModal'
import { CommandPalette } from './components/CommandPalette'
import { Momo } from './components/Momo'
import { extractWikiLinks } from './lib/md'
import { isTauri, platform } from './lib/platform'
import { ConfirmHost } from './components/ui/ConfirmHost'
import { TooltipLayer, useGlobalTooltip } from './components/ui/Tooltip'
import { Icon } from './components/ui/Icon'
import { AiPanel } from './components/AiPanel'
import { GraphModal } from './components/GraphModal'
import { HealthModal } from './components/HealthModal'
import { AiLogModal } from './components/AiLogModal'

export default function App() {
  const state = useVault()
  const tip = useGlobalTooltip()
  const editorRef = useRef<EditorHandle>(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [outlineOpen, setOutlineOpen] = useState(true)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [jump, setJump] = useState<{ line: number; token: number } | null>(null)
  const [epoch, setEpoch] = useState(0)
  const [pendingFiles, setPendingFiles] = useState<File[] | null>(null)
  const [initError, setInitError] = useState<string | null>(null)
  const [openTabs, setOpenTabs] = useState<string[]>([])
  const [aiOpen, setAiOpen] = useState(false)
  const [graphOpen, setGraphOpen] = useState(false)
  const [healthOpen, setHealthOpen] = useState(false)
  const [aiLogOpen, setAiLogOpen] = useState(false)

  const doc = state.docs.find((d) => d.id === state.activeId) ?? null

  useEffect(() => {
    if (!state.activeId) return
    setOpenTabs((prev) => (prev.includes(state.activeId!) ? prev : [...prev, state.activeId!].slice(-8)))
  }, [state.activeId])

  // 兼容旧版本保存的“侧栏 AI 标签”：迁移成右侧 AI 抽屉
  useEffect(() => {
    if (state.sidebar !== 'ai') return
    setAiOpen(true)
    vault.setSidebar('files')
  }, [state.sidebar])

  useEffect(() => {
    setOpenTabs((prev) => prev.filter((id) => state.docs.some((d) => d.id === id)))
  }, [state.docs])

  useEffect(() => {
    const onRestored = () => setEpoch((n) => n + 1)
    window.addEventListener('inkspire:vault-restored', onRestored)
    return () => window.removeEventListener('inkspire:vault-restored', onRestored)
  }, [])

  useEffect(() => {
    const open = () => setAiLogOpen(true)
    window.addEventListener('inkspire:ai-log', open)
    return () => window.removeEventListener('inkspire:ai-log', open)
  }, [])

  useEffect(() => {
    vault.init().catch((e) => setInitError(String(e?.stack || e)))
    const params = new URLSearchParams(window.location.search)
    if (params.get('settings') === '1') vault.setModal({ settingsOpen: true })
    if (params.get('import') === '1') vault.setModal({ importOpen: true })
    if (params.get('palette') === '1') vault.setModal({ paletteOpen: true })
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey
      if (e.key === 'Escape') {
        // 确认框自己处理 Esc，避免把背后的设置也一起关掉
        if (document.querySelector('.confirm-modal')) return
        const s = vault.state
        if (s.paletteOpen) vault.setModal({ paletteOpen: false })
        else if (s.settingsOpen) {
          vault.setModal({ settingsOpen: false })
          void vault.flushSettings()
        } else if (s.importOpen) vault.setModal({ importOpen: false })
        else if (s.versionsOpen) vault.setModal({ versionsOpen: false })
        return
      }
      if (meta && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        vault.setModal({ paletteOpen: !vault.state.paletteOpen })
      }
      if (meta && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        void newDoc()
      }
      if (meta && e.shiftKey && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        void vault.openDailyNote()
      }
      if (meta && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void editorRef.current?.flush().then((saved) => {
          void vault.flushSettings()
          if (saved) vault.flash('已保存', 'success')
        })
      }
      if (meta && e.key.toLowerCase() === 'j') {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('inkspire:ai', { detail: { mode: 'continue' } }))
      }
      if (meta && e.shiftKey && e.key.toLowerCase() === 'g') {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('inkspire:ai', { detail: { mode: 'figure' } }))
      }
      if (meta && e.key === '/') {
        e.preventDefault()
        void vault.updateSettings({ sourceMode: !vault.state.settings.sourceMode })
      }
      if (meta && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        vault.setSidebar('search')
        setSidebarOpen(true)
      }
      if (meta && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        if (vault.state.settings.focusMode) void vault.updateSettings({ focusMode: false })
        setSidebarOpen((v) => !v)
      }
      if (meta && e.key === '\\') {
        // UI 规范 §8.6 / §9.4：⌘\ 隐藏桌宠（侧栏改用 ⌘B）
        e.preventDefault()
        void vault.updateSettings({ showPet: !vault.state.settings.showPet })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    const flush = () => {
      void editorRef.current?.flush()
      void vault.flushSettings()
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('pagehide', flush)
    window.addEventListener('beforeunload', flush)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', flush)
      window.removeEventListener('beforeunload', flush)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  // 桌面端关窗先试着把最后一段输入落盘，再真正关闭
  useEffect(() => {
    if (!isTauri) return
    let off: (() => void) | null = null
    let closing = false
    void import('@tauri-apps/api/window').then(async ({ getCurrentWindow }) => {
      const win = getCurrentWindow()
      off = await win.onCloseRequested(async (event) => {
        if (closing) return
        event.preventDefault()
        closing = true
        try {
          await editorRef.current?.flush()
          await vault.flushSettings()
        } finally {
          await win.destroy().catch(() => undefined)
        }
      })
    })
    return () => off?.()
  }, [])

  useEffect(() => {
    const title = doc ? `${doc.title} — Inkspire` : 'Inkspire'
    document.title = title
    if (!isTauri) return
    void import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
      void getCurrentWindow().setTitle(title).catch(() => undefined)
    })
  }, [doc?.title])

  useEffect(() => {
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault()
    }
    const onDrop = (e: DragEvent) => {
      if (!e.dataTransfer?.files.length) return
      e.preventDefault()
      setPendingFiles(Array.from(e.dataTransfer.files))
      vault.setModal({ importOpen: true })
    }
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('drop', onDrop)
    }
  }, [])

  const newDoc = useCallback(async () => {
    await editorRef.current?.flush()
    const now = new Date()
    const title = `未命名 ${now.getMonth() + 1}-${now.getDate()} ${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`
    await vault.createDoc({ title, path: `${title}.md`, content: `# ${title}\n\n` })
    setMobileOpen(false)
    setTimeout(() => editorRef.current?.focus(), 60)
  }, [])

  useEffect(() => {
    if (!isTauri) return
    let off: (() => void) | null = null
    void platform.listen<{ action: string }>('inkspire:pet:action', (p) => {
      if (p.action === 'new-note') {
        void newDoc()
        void platform.petActivate()
      } else if (p.action === 'focus') {
        void platform.petActivate()
      } else if (p.action === 'settings') {
        vault.setModal({ settingsOpen: true })
        void platform.petActivate()
      } else if (p.action === 'hide-pet') {
        void vault.updateSettings({ showPet: false })
      } else if (p.action === 'cheer') {
        vault.pet('happy', '谢谢你还记得我 ✦', 2500)
      }
    }).then((u) => (off = u))
    return () => off?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!isTauri || !state.ready) return
    const send = () => {
      const start = new Date()
      start.setHours(0, 0, 0, 0)
      const words = state.docs.filter((d) => d.updatedAt >= start.getTime()).reduce((n, d) => n + d.wordCount, 0)
      void platform.emit('inkspire:pet:stats', { words })
    }
    send()
    const timer = window.setInterval(send, 15_000)
    return () => window.clearInterval(timer)
  }, [state.ready, state.docs.length, state.savedAt])

  const getSelection = useCallback(
    () => editorRef.current?.getSelection() ?? { from: 0, to: 0, text: '' },
    [],
  )

  const openDoc = useCallback(async (id: string, line?: number) => {
    await editorRef.current?.flush()
    await vault.setActive(id)
    if (typeof line === 'number') setJump({ line, token: Date.now() })
    setMobileOpen(false)
  }, [])

  const reloadFromDisk = useCallback(async () => {
    if (!isTauri) {
      vault.flash('浏览器预览没有外部磁盘可刷新', 'info')
      return
    }
    await editorRef.current?.flush()
    if (vault.state.saveErrorDocId) {
      vault.flash('当前文档还没保存成功，先处理保存错误再刷新', 'error')
      return
    }
    try {
      const res = await vault.refreshFromDisk()
      const total = res.changed + res.added + res.removed
      if (!total) {
        vault.flash('没有检测到外部修改', 'info')
        return
      }
      if (res.activeChanged) setEpoch((n) => n + 1)
      const parts = [
        res.changed ? `${res.changed} 篇更新` : '',
        res.added ? `${res.added} 篇新增` : '',
        res.removed ? `${res.removed} 篇移除` : '',
      ].filter(Boolean)
      vault.flash(`已从磁盘刷新：${parts.join('、')}`, 'success')
    } catch (e: any) {
      vault.flash(`刷新失败：${e?.message ?? e}`, 'error')
    }
  }, [])

  const closeTab = useCallback(
    async (id: string) => {
      if (id === state.activeId) {
        const idx = openTabs.indexOf(id)
        const next = openTabs.filter((x) => x !== id)
        const target = next[Math.min(idx, next.length - 1)] ?? null
        if (id === state.activeId) await editorRef.current?.flush()
        setOpenTabs(next)
        if (target) await openDoc(target)
        else vault.setActiveId(null)
        if (!target) setMobileOpen(false)
      } else {
        setOpenTabs((prev) => prev.filter((x) => x !== id))
      }
    },
    [openTabs, state.activeId, openDoc],
  )

  const openWiki = useCallback(
    (target: string) => {
      const t = target.trim().toLowerCase()
      const found = vault.state.docs.find(
        (d) => d.title.toLowerCase() === t || d.path.replace(/\.md$/i, '').toLowerCase() === t || d.frontMatter.aliases.some((a) => a.toLowerCase() === t),
      )
      if (found) {
        void openDoc(found.id)
        return
      }
      void vault.createDoc({ title: target.trim(), path: `${target.trim()}.md`, content: `# ${target.trim()}\n\n> 这是一条尚未存在的链接，现在它有了自己的位置。\n` }).then((d) => {
        vault.flash(`已创建《${d.title}》`, 'success')
        setEpoch((n) => n + 1)
      })
    },
    [openDoc],
  )

  const diskHashRef = useRef('')
  const pendingHashRef = useRef('')
  useEffect(() => {
    if (!isTauri || !state.ready) return
    let stopped = false
    let checking = false
    const check = async () => {
      if (stopped || checking || document.visibilityState !== 'visible') return
      checking = true
      try {
        const sig = await platform.vaultSignature()
        if (stopped) return
        if (!diskHashRef.current) {
          diskHashRef.current = sig.hash
          return
        }
        if (sig.hash === diskHashRef.current) {
          pendingHashRef.current = ''
          return
        }
        if (editorRef.current?.isDirty() || vault.state.savingDocId || vault.state.saveErrorDocId) {
          if (pendingHashRef.current !== sig.hash) {
            pendingHashRef.current = sig.hash
            vault.flash('检测到外部修改；当前还有未保存内容，保存后会再刷新', 'info')
          }
          return
        }
        const res = await vault.refreshFromDisk()
        const total = res.changed + res.added + res.removed
        diskHashRef.current = sig.hash
        pendingHashRef.current = ''
        if (res.activeChanged) setEpoch((n) => n + 1)
        if (total) {
          const parts = [
            res.changed ? `${res.changed} 篇更新` : '',
            res.added ? `${res.added} 篇新增` : '',
            res.removed ? `${res.removed} 篇移除` : '',
          ].filter(Boolean)
          vault.flash(`检测到外部修改，已刷新：${parts.join('、')}`, 'success')
        }
      } catch {
        /* 外部监听失败不打扰写作 */
      } finally {
        checking = false
      }
    }
    const timer = window.setInterval(() => void check(), 20_000)
    void check()
    const onFocus = () => void check()
    window.addEventListener('focus', onFocus)
    return () => {
      stopped = true
      window.clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [state.ready])

  const fontMap = { sans: 'var(--font)', serif: 'var(--serif)', mono: 'var(--mono)' } as const
  const appStyle = {
    '--editor-size': `${state.settings.fontSize}px`,
    '--editor-width': `${state.settings.lineWidth}px`,
    '--editor-font': fontMap[state.settings.fontFamily],
  } as CSSProperties

  if (initError) {
    return (
      <div className="app" style={appStyle}>
        <div className="crash">
          <div className="crash-card">
            <h1>书桌没有打开</h1>
            <p>应用没能读取本地数据。文档通常仍在磁盘或浏览器存储里；可以先重试，或检查保存位置与权限。</p>
            <pre>{initError}</pre>
            <div className="crash-actions">
              <button className="tbtn primary" onClick={() => window.location.reload()}>重新加载</button>
              <button className="tbtn" onClick={() => void navigator.clipboard?.writeText(initError)}>复制细节</button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (!state.ready) {
    return (
      <div className="app" style={appStyle}>
        <div className="editor-empty" style={{ height: '100vh' }}>
          <Momo mood="thinking" className="big" />
          <div>墨墨正在整理书桌…</div>
        </div>
      </div>
    )
  }

  const focusMode = state.settings.focusMode
  const showSidebar = sidebarOpen && !focusMode
  const showOutline = outlineOpen && !focusMode

  return (
    <div className={`app${state.settings.focusMode ? ' focus-mode' : ''}${aiOpen ? ' ai-open' : ''}`} style={appStyle} data-theme={state.settings.theme}>
      <TopBar
        onNewDoc={() => void newDoc()}
        onOpenImport={() => vault.setModal({ importOpen: true })}
        onOpenSettings={() => vault.setModal({ settingsOpen: true })}
        onOpenPalette={() => vault.setModal({ paletteOpen: true })}
        onToggleSidebar={() => {
          if (state.settings.focusMode) void vault.updateSettings({ focusMode: false })
          setSidebarOpen((v) => !v)
          setMobileOpen((v) => !v)
        }}
        onOpenAI={() => setAiOpen((v) => !v)}
        onRetrySave={() => {
          void editorRef.current?.flush().then((saved) => {
            if (saved) vault.flash('已重新保存', 'success')
            else if (vault.state.saveErrorDocId) vault.flash('仍然无法保存，请检查磁盘权限或当前文档是否被占用', 'error')
          })
        }}
      />

      <div className={`workspace${showSidebar ? '' : ' sidebar-collapsed'}${showOutline ? '' : ' outline-collapsed'}${mobileOpen ? ' mobile-sidebar-open' : ''}`}>
        <Sidebar
          onOpenDoc={(id, line) => void openDoc(id, line)}
          onNewDoc={() => void newDoc()}
          onOpenImport={() => vault.setModal({ importOpen: true })}
          onOpenGraph={() => setGraphOpen(true)}
          onRenameFolder={async (path, name) => {
            await editorRef.current?.flush()
            await vault.renameFolder(path, name)
          }}
        />
        {mobileOpen && <div className="drawer-mask" onClick={() => setMobileOpen(false)} />}

        {doc ? (
          <EditorPane
            key={`${doc.id}-${epoch}`}
            ref={editorRef}
            doc={doc}
            jumpTo={jump}
            onOpenWiki={openWiki}
            onOpenSource={(id, line) => void openDoc(id, line)}
            onOpenVersions={() => vault.setModal({ versionsOpen: true })}
            outlineOpen={showOutline}
            onToggleOutline={() => {
              if (state.settings.focusMode) void vault.updateSettings({ focusMode: false })
              setOutlineOpen((v) => !v)
            }}
            tabs={openTabs.map((id) => {
              const d = state.docs.find((x) => x.id === id)
              return { id, title: d?.title ?? '未命名' }
            })}
            onSwitchTab={(id) => void openDoc(id)}
            onCloseTab={(id) => void closeTab(id)}
          />
        ) : (
          <div className="editor-col">
            <div className="editor-empty">
              <Momo mood="happy" className="big" />
              <div style={{ fontWeight: 800, fontSize: 16, color: 'var(--ink)' }}>书桌是空的</div>
              <div>新建一篇文档，或把 PDF / EPUB / Markdown 拖进窗口。</div>
              <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                <button className="tbtn primary" onClick={() => void newDoc()}><Icon name="plus" size={15} /> 新建文档</button>
                <button className="tbtn" onClick={() => vault.setModal({ importOpen: true })}><Icon name="download" size={15} /> 导入文件</button>
              </div>
            </div>
          </div>
        )}

        {showOutline && (
          <Outline
            onJump={(line) => editorRef.current?.scrollToLine(line)}
            onOpenDoc={(id, line) => void openDoc(id, line)}
          />
        )}
      </div>

      {!isTauri && <Pet />}

      {aiOpen && (
        <aside className="ai-drawer" aria-label="AI 助手">
          <AiPanel
            onInsert={(text) => editorRef.current?.insertText(text, { block: true })}
            onOpenDoc={(id, line) => void openDoc(id, line)}
            getSelection={getSelection}
            onClose={() => setAiOpen(false)}
          />
        </aside>
      )}

      {state.toast && (
        <div className={`toast ${state.toast.kind}`} role="status" aria-live="polite">
          {state.toast.text}
          <button type="button" className="toast-close" aria-label="关闭提示" onClick={() => vault.dismissToast()}>
            <Icon name="close" size={12} />
          </button>
        </div>
      )}

      <ConfirmHost />
      <TooltipLayer tip={tip} />
      {state.settingsOpen && (
        <SettingsModal
          onClose={() => {
            vault.setModal({ settingsOpen: false })
            void vault.flushSettings()
          }}
        />
      )}
      {state.importOpen && <ImportModal initialFiles={pendingFiles ?? undefined} onClose={() => { vault.setModal({ importOpen: false }); setPendingFiles(null) }} />}
      {state.versionsOpen && doc && (
        <VersionsModal
          doc={doc}
          onClose={() => vault.setModal({ versionsOpen: false })}
          onRestored={() => setEpoch((n) => n + 1)}
        />
      )}
      {graphOpen && (
        <GraphModal
          docs={state.docs}
          onOpenDoc={(id) => void openDoc(id)}
          onClose={() => setGraphOpen(false)}
        />
      )}
      {healthOpen && (
        <HealthModal
          docs={state.docs}
          onOpenDoc={(id, line) => void openDoc(id, line)}
          onOpenGraph={() => {
            setHealthOpen(false)
            setGraphOpen(true)
          }}
          onClose={() => setHealthOpen(false)}
        />
      )}
      {aiLogOpen && doc && (
        <AiLogModal
          docId={doc.id}
          docTitle={doc.title}
          onRestore={(id) => editorRef.current?.restoreAiEdit(id) ?? false}
          onClose={() => setAiLogOpen(false)}
        />
      )}
      {state.paletteOpen && (
        <CommandPalette
          onClose={() => vault.setModal({ paletteOpen: false })}
          onOpenDoc={(id, line) => void openDoc(id, line)}
          onNewDoc={() => void newDoc()}
          onOpenImport={() => vault.setModal({ importOpen: true })}
          onOpenSettings={() => vault.setModal({ settingsOpen: true })}
          onOpenVersions={() => vault.setModal({ versionsOpen: true })}
          onOpenGraph={() => setGraphOpen(true)}
          onOpenHealth={() => setHealthOpen(true)}
          onReloadFromDisk={() => void reloadFromDisk()}
        />
      )}
    </div>
  )
}
