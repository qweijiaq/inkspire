import { useEffect, useMemo, useRef, useState } from 'react'
import { vault, useVault } from '../store'
import { Momo } from './Momo'
import { Icon } from './ui/Icon'
import { confirmDialog } from '../lib/dialog'
import { buildMessages, streamChat } from '../lib/ai'
import { apiKeyFor, needsApiKey } from '../lib/providers'
import { isLocalProvider } from '../lib/providers'
import { extractHeadings, parseFrontMatter } from '../lib/md'
import type { ContextSource } from '../types'
import { AiActions } from './AiActions'
import { AI_ACTION_COUNT, type AiAction } from '../lib/aiActions'
import { loadMemories } from '../lib/memories'

interface Msg {
  id: string
  role: 'user' | 'assistant'
  content: string
  streaming?: boolean
  error?: string
  sources?: ContextSource[]
}

const QUICK = ['总结这篇文档', '找出文中的矛盾或缺口', '这篇和库里哪些笔记有关？', '生成 3 个小节标题']
const CHAT_KEY = 'inkspire:aiChat'

function loadChat(): Msg[] {
  try {
    const raw = localStorage.getItem(CHAT_KEY)
    if (!raw) return []
    const rows = JSON.parse(raw)
    if (!Array.isArray(rows)) return []
    return rows
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .slice(-20)
      .map((m, i) => ({ id: `restored-${i}`, role: m.role, content: m.content, sources: m.sources }))
  } catch {
    return []
  }
}

export function AiPanel({ onInsert, onOpenDoc, getSelection, onClose }: {
  onInsert: (text: string) => void
  onOpenDoc: (id: string, line?: number) => void
  getSelection: () => { from: number; to: number; text: string }
  onClose?: () => void
}) {
  const state = useVault()
  const doc = state.docs.find((d) => d.id === state.activeId)
  const [messages, setMessages] = useState<Msg[]>(loadChat)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [selection, setSelection] = useState('')
  const [related, setRelated] = useState<ContextSource[]>([])
  const [retrieval, setRetrieval] = useState<{ mode: 'semantic' | 'keyword'; note?: string } | null>(null)
  const [actionsOpen, setActionsOpen] = useState(false)
  const listRef = useRef<HTMLDivElement | null>(null)
  const deltaBuf = useRef('')
  const deltaRaf = useRef(0)

  const headings = useMemo(() => (doc ? extractHeadings(doc.content).map((h) => h.text) : []), [doc?.content])

  // 全库检索放到防抖里，避免每次自动保存都同步扫一遍所有文档
  useEffect(() => {
    if (!doc) {
      setRelated([])
      return
    }
    const timer = window.setTimeout(() => {
      setRelated(vault.findContext(`${doc.title} ${headings.slice(0, 6).join(' ')}`, doc.id, 3))
    }, 450)
    return () => window.clearTimeout(timer)
  }, [doc?.id, doc?.content, headings])

  useEffect(() => {
    const open = () => setActionsOpen(true)
    window.addEventListener('inkspire:ai-actions', open)
    return () => window.removeEventListener('inkspire:ai-actions', open)
  }, [])

  // E19：对话留在本机，重开应用还能接着上次聊
  useEffect(() => {
    try {
      const saved = messages
        .filter((m) => !m.streaming && m.content.trim())
        .slice(-20)
        .map((m) => ({ role: m.role, content: m.content, sources: m.sources }))
      localStorage.setItem(CHAT_KEY, JSON.stringify(saved))
    } catch {
      /* ignore quota */
    }
  }, [messages])

  useEffect(() => () => {
    if (deltaRaf.current) cancelAnimationFrame(deltaRaf.current)
  }, [])

  useEffect(() => {
    const onSelection = (event: Event) => {
      const text = String((event as CustomEvent<string>).detail ?? '').trim()
      setSelection((prev) => (prev === text ? prev : text))
    }
    const tick = () => {
      try {
        const text = getSelection().text.trim()
        setSelection((prev) => (prev === text ? prev : text))
      } catch {
        /* ignore */
      }
    }
    tick()
    window.addEventListener('inkspire:selection', onSelection)
    const id = window.setInterval(tick, 3000)
    return () => {
      window.removeEventListener('inkspire:selection', onSelection)
      window.clearInterval(id)
    }
  }, [doc?.id, getSelection])

  const ask = async (question: string) => {
    if (!doc || !question.trim() || busy) return
    const picked = (() => {
      try {
        return getSelection().text.trim()
      } catch {
        return ''
      }
    })()
    setSelection(picked)
    const ai = state.settings.ai
    if (!ai.enabled) {
      vault.flash('先在设置里启用 AI', 'error')
      vault.setModal({ settingsOpen: true })
      return
    }
    if (state.settings.privacyLocalOnly && !isLocalProvider(ai.provider)) {
      vault.flash('隐私模式已开启：请切换到本地 Ollama / LM Studio，或关闭隐私模式', 'error')
      vault.setModal({ settingsOpen: true })
      return
    }
    if (needsApiKey(ai.provider) && !apiKeyFor(ai)) {
      const loaded = await vault.ensureProviderKey(ai.provider)
      if (!loaded) {
        vault.flash('这个服务商还没有配置 API Key', 'error')
        vault.setModal({ settingsOpen: true })
        return
      }
    }
    const budget = ai.contextChars || 6000
    if (!vault.checkAiBudget(budget + 400)) return
    setBusy(true)
    const body = parseFrontMatter(doc.content).body
    const history = messages.slice(-4).map((m) => `${m.role === 'user' ? '问' : '答'}：${m.content.slice(0, 600)}`).join('\n')
    const smart = await vault.findContextSmart(`${question} ${picked.slice(0, 240)}`, doc.id, 3)
    const sources = smart.sources
    setRelated(sources)
    setRetrieval({ mode: smart.mode, note: smart.note })
    const prompt = `${history ? `对话历史：\n${history}\n\n` : ''}${question}`
    const msgList = buildMessages(
      'custom',
      {
        title: doc.title,
        headings,
        selection: picked.slice(0, 2000),
        before: body.slice(-budget),
        after: '',
        related: sources.map((s) => ({ title: s.title, excerpt: s.excerpt.slice(0, 500) })),
        memories: loadMemories().map((m) => m.text),
        persona: state.settings.persona,
        budget,
      },
      prompt,
    )
    setInput('')
    const answerId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    setMessages((prev) => [
      ...prev,
      { id: `q-${answerId}`, role: 'user', content: question },
      { id: answerId, role: 'assistant', content: '', streaming: true, sources },
    ])
    let full = ''
    try {
      const text = await streamChat(vault.state.settings.ai, msgList, (delta) => {
        full += delta
        deltaBuf.current += delta
        if (!deltaRaf.current) {
          deltaRaf.current = requestAnimationFrame(() => {
            deltaRaf.current = 0
            const chunk = deltaBuf.current
            deltaBuf.current = ''
            if (!chunk) return
            setMessages((prev) => prev.map((m) => (m.id === answerId ? { ...m, content: m.content + chunk } : m)))
          })
        }
      })
      vault.recordUsage(JSON.stringify(msgList).length, text.length)
      setMessages((prev) => prev.map((m) => (m.id === answerId ? { ...m, streaming: false } : m)))
    } catch (e: any) {
      setMessages((prev) =>
        prev.map((m) => (m.id === answerId ? { ...m, streaming: false, error: e?.message ?? String(e) } : m)),
      )
    } finally {
      setBusy(false)
      requestAnimationFrame(() => listRef.current?.scrollTo({ top: 999999 }))
    }
  }

  return (
    <div className="ai-panel">
      <div className="ai-panel-head">
        <Momo mood={busy ? 'thinking' : 'happy'} className="momo-mini" />
        <span>问墨墨</span>
        <button className="ai-actions-entry" onClick={() => setActionsOpen(true)} data-tip="打开 AI 动作库">
          动作库 · {AI_ACTION_COUNT}
        </button>
        <button
          onClick={async () => {
            if (!messages.length) return
            const ok = await confirmDialog({
              title: '清空对话',
              message: '会清除本机保存的这段 AI 对话，不影响文档。',
              confirmText: '清空对话',
              danger: true,
            })
            if (ok) setMessages([])
          }}
          disabled={!messages.length}
        >
          清空
        </button>
        {onClose && (
          <button type="button" className="ai-panel-close" onClick={onClose} aria-label="关闭 AI 助手" data-tip="关闭 AI 助手">
            <Icon name="close" size={15} />
          </button>
        )}
      </div>

      <div className="ai-panel-list" ref={listRef}>
        {retrieval && (
          <div className={`ai-retrieval${retrieval.note ? ' fallback' : ''}`}>
            {retrieval.mode === 'semantic' ? '本次用语义向量召回相关笔记' : '本次用关键词召回相关笔记'}
            {retrieval.note ? ` · ${retrieval.note}` : ''}
          </div>
        )}
        {related.length > 0 && (
          <div className="ai-sources ai-related">
            <span>相关笔记{retrieval?.mode === 'semantic' ? ' · 语义' : ''}</span>
            {related.map((s) => (
              <button key={s.id} onClick={() => onOpenDoc(s.id, s.line)} data-tip={s.excerpt.slice(0, 80)}>
                {s.title}
              </button>
            ))}
          </div>
        )}
        {!messages.length && (
          <div className="empty-hint" style={{ padding: '12px 8px' }}>
            基于当前文档提问，并自动检索库内相关笔记作为参考。回答不会自动写入，点「插入」才落笔。
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`ai-msg ${m.role}`}>
            <div className="ai-msg-role">{m.role === 'user' ? '你' : '墨墨'}</div>
            <div className="ai-msg-body">
              {m.content || (m.streaming ? '…' : '')}
              {m.error && <div style={{ color: 'var(--coral-strong)' }}>{m.error}</div>}
            </div>
            {m.role === 'assistant' && !m.streaming && m.sources && m.sources.length > 0 && (
              <details className="ai-evidence">
                <summary>依据与详情</summary>
                <ul>
                  {m.sources.map((s) => (
                    <li key={`ev-${s.id}`}>
                      <button type="button" onClick={() => onOpenDoc(s.id, s.line)}>{s.title}</button>
                      <span>第 {s.line + 1} 行</span>
                      <p>{s.excerpt.slice(0, 180)}</p>
                    </li>
                  ))}
                </ul>
                <em>AI 生成 · 建议态 · 来源可跳转</em>
              </details>
            )}
            {m.role === 'assistant' && !m.streaming && m.content && (
              <div className="ai-msg-actions">
                <button onClick={() => onInsert(`\n\n${m.content}\n`)}>插入到光标</button>
                <button onClick={() => void navigator.clipboard?.writeText(m.content)}>复制</button>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="ai-quick">
        {QUICK.map((q) => (
          <button key={q} onClick={() => void ask(q)} disabled={busy || !doc}>
            {q}
          </button>
        ))}
      </div>

      {actionsOpen && (
        <AiActions
          onClose={() => setActionsOpen(false)}
          onRun={(action: AiAction) => {
            setActionsOpen(false)
            window.dispatchEvent(new CustomEvent('inkspire:ai', { detail: { mode: 'custom', instruction: action.prompt } }))
          }}
        />
      )}

      <div className="ai-panel-input">
        {selection && (
          <div className="ai-selection-hint">
            将结合选中的 {selection.length} 字
            <button onClick={() => setSelection('')}>忽略</button>
          </div>
        )}
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={doc ? `问问《${doc.title}》…` : '先打开一篇文档'}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              void ask(input)
            }
          }}
        />
        <button className="tbtn primary" disabled={busy || !input.trim()} onClick={() => void ask(input)}>
          {busy ? '…' : '发送'}
        </button>
      </div>
    </div>
  )
}
