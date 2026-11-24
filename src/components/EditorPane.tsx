import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Compartment, EditorState, StateEffect, StateField } from '@codemirror/state'
import { EditorView, keymap, drawSelection, placeholder, Decoration, ViewPlugin, WidgetType, type DecorationSet } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown, markdownKeymap } from '@codemirror/lang-markdown'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { languages } from '@codemirror/language-data'
import { search, searchKeymap } from '@codemirror/search'
import { autocompletion, closeBrackets, closeBracketsKeymap, type CompletionContext } from '@codemirror/autocomplete'
import { livePreview, type MermaidEditPayload, type TableEditPayload } from '../editor/livePreview'
import { BlockEditor, type BlockEditState } from './BlockEditor'
import { CardEditor, type CardDraft } from './CardEditor'
import { addCard, loadLearning, staleCards } from '../lib/learning'
import { addReadingSeconds, getReading, saveReading } from '../lib/reading'
import { loadMemories } from '../lib/memories'
import { vault, useVault } from '../store'
import { isTauri, platform } from '../lib/platform'
import { Momo } from './Momo'
import { buildMessages, streamChat } from '../lib/ai'
import { useOutsideClose } from './ui/popover'
import { Icon, type IconName } from './ui/Icon'
import { apiKeyFor, needsApiKey } from '../lib/providers'
import { isLocalProvider, defaultImageModel } from '../lib/providers'
import { presetOf } from '../lib/providers'
import { saveAsset, dataUrlToBlob } from '../lib/assets'
import { checkRenderedFigure } from '../lib/figures/domCheck'
import { findAiEdit, latestAiEdit, recordAiEdit, removeAiEdit, removeAiEditsFrom, type AiEdit } from '../lib/aiEdits'
import { confirmDialog } from '../lib/dialog'
import { DiffView } from './ui/DiffView'
import { clearFigurePlan, loadFigurePlan, saveFigurePlan } from '../lib/figurePlanStore'
import { coverBudget, recordCover } from '../lib/coverUsage'
import { extractHeadings, parseFrontMatter, formatTime } from '../lib/md'
import type { AISuggestion, Document, Mood, SourceRef } from '../types'
import { FIGURE_LABEL, FIGURE_PLAN_PROMPT, FIGURE_PROMPT, figureExportSvg, figureMarkdown, parseFigurePlan, parseFigureResponse, renderFigureSvg, svgToPngBlob, validateFigure, type FigureIssue, type FigureSpec } from '../lib/figures'
import { Checkbox } from './ui/Checkbox'
import { downloadBlob } from '../lib/export'

const inkHighlight = HighlightStyle.define([
  { tag: [tags.keyword, tags.modifier], color: 'var(--code-keyword)', fontWeight: '700' },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--code-string)' },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: 'var(--code-comment)', fontStyle: 'italic' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--code-number)' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: 'var(--code-function)' },
  { tag: [tags.typeName, tags.className, tags.namespace], color: 'var(--code-type)' },
  { tag: [tags.operator, tags.punctuation], color: 'var(--code-operator)' },
  { tag: [tags.propertyName, tags.attributeName], color: 'var(--code-property)' },
  { tag: [tags.tagName, tags.angleBracket], color: 'var(--code-tag)' },
  { tag: tags.heading, color: 'var(--code-heading)', fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strong, fontWeight: '800' },
])

const ghostEffect = StateEffect.define<{ from: number; text: string } | null>()

class GhostWidget extends WidgetType {
  constructor(readonly text: string) {
    super()
  }
  eq(other: GhostWidget) {
    return other.text === this.text
  }
  toDOM() {
    const span = document.createElement('span')
    span.className = 'cm-ghost'
    span.textContent = this.text
    span.setAttribute('aria-label', 'AI 幽灵建议，采纳后才写入')
    return span
  }
  ignoreEvent() {
    return true
  }
}

const ghostField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    let next = value.map(tr.changes)
    for (const effect of tr.effects) {
      if (!effect.is(ghostEffect)) continue
      if (!effect.value || !effect.value.text) return Decoration.none
      const at = Math.max(0, Math.min(effect.value.from, tr.state.doc.length))
      const line = tr.state.doc.lineAt(at)
      const anchor = line.to < tr.state.doc.length ? line.to + 1 : line.to
      next = Decoration.set([
        Decoration.widget({ widget: new GhostWidget(effect.value.text), side: 1 }).range(anchor),
      ])
    }
    return next
  },
  provide: (field) => EditorView.decorations.from(field),
})

export interface EditorHandle {
  getView: () => EditorView | null
  getSelection: () => { from: number; to: number; text: string }
  insertText: (text: string, opts?: { block?: boolean }) => void
  replaceRange: (from: number, to: number, text: string) => void
  scrollToLine: (line: number, fmOffset?: number) => void
  focus: () => void
  /** 立即落盘；返回是否真的写入了改动 */
  flush: () => Promise<boolean>
  /** 是否有尚未落盘的编辑 */
  isDirty: () => boolean
  /** 回放到某条 AI 写入之前 */
  restoreAiEdit: (id: string) => Promise<boolean>
}

interface Props {
  doc: Document
  jumpTo?: { line: number; token: number } | null
  onOpenWiki: (target: string) => void
  onOpenSource: (docId: string, line: number) => void
  onOpenVersions: () => void
  outlineOpen: boolean
  onToggleOutline: () => void
  tabs: { id: string; title: string }[]
  onSwitchTab: (id: string) => void
  onCloseTab: (id: string) => void
}

function findRelated(currentId: string, text: string): { docId: string; title: string; line: number; excerpt: string; score: number }[] {
  const tokens = [...new Set((text.match(/[\u4e00-\u9fa5]{2,}|[A-Za-z]{3,}/g) ?? []).map((t) => t.toLowerCase()))]
    .filter((t) => t.length >= 2)
    .slice(0, 60)
  if (!tokens.length) return []
  const out: { docId: string; title: string; line: number; excerpt: string; score: number }[] = []
  for (const d of vault.state.docs) {
    if (d.id === currentId) continue
    const body = parseFrontMatter(d.content).body
    const lower = body.toLowerCase()
    let score = 0
    let line = 0
    let excerpt = ''
    for (const t of tokens) {
      const idx = lower.indexOf(t)
      if (idx >= 0) {
        score++
        if (!excerpt) {
          line = body.slice(0, idx).split('\n').length - 1
          excerpt = body.split('\n')[line]?.trim().slice(0, 100) ?? ''
        }
      }
    }
    if (score >= 2) out.push({ docId: d.id, title: d.title, line, excerpt, score })
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 3)
}

const MODE_LABEL: Record<string, string> = {
  continue: '续写',
  rewrite: '润色',
  summarize: '总结',
  translate: '翻译',
  'polish-doc': '全文润色排版',
  custom: '自定义',
  'polish-headings': '小标题',
}

const AI_MENU: { icon: IconName; label: string; mode: string; instruction?: string }[] = [
  { icon: 'edit', label: '接着写（⌘J）', mode: 'continue' },
  { icon: 'wand', label: '润色选区', mode: 'rewrite' },
  { icon: 'sparkles', label: '全文润色排版', mode: 'polish-doc' },
  { icon: 'scissors', label: '精简选区', mode: 'rewrite', instruction: '压缩到原文的一半长度，保留全部关键信息' },
  { icon: 'pin', label: '总结本文', mode: 'summarize' },
  { icon: 'globe', label: '翻译', mode: 'translate' },
  { icon: 'compass', label: '解释选段', mode: 'custom', instruction: '用简洁的中文解释选中的文字，指出可能的歧义或问题。' },
  { icon: 'listCheck', label: '提取待办', mode: 'custom', instruction: '从选中的内容里提取行动项，输出 Markdown 任务列表（- [ ] ）。' },
  { icon: 'sparkles', label: '生成小标题', mode: 'polish-headings' },
  { icon: 'compass', label: '生成图解', mode: 'figure' },
  { icon: 'book', label: '整篇配图', mode: 'figure-plan' },
  { icon: 'image', label: '生成封面图', mode: 'cover' },
  { icon: 'history', label: '撤销上次 AI 写入', mode: 'undo-ai' },
  { icon: 'history', label: 'AI 操作日志', mode: 'ai-log' },
]

type SlashItem = {
  icon: IconName
  label: string
  hint: string
  keys: string
  insert?: string
  cursor?: number
  ai?: string
  action?: 'daily'
}

const SLASH_ITEMS: SlashItem[] = [
  { icon: 'edit', label: '一级标题', hint: '/h1', keys: 'h1 标题 heading', insert: '# ' },
  { icon: 'edit', label: '二级标题', hint: '/h2', keys: 'h2 标题 heading', insert: '## ' },
  { icon: 'edit', label: '三级标题', hint: '/h3', keys: 'h3 标题 heading', insert: '### ' },
  { icon: 'listCheck', label: '无序列表', hint: '/ul', keys: 'ul 列表 list', insert: '- ' },
  { icon: 'listCheck', label: '任务清单', hint: '/todo', keys: 'todo task 任务 待办', insert: '- [ ] ' },
  { icon: 'hash', label: '有序列表', hint: '/ol', keys: 'ol 编号 列表', insert: '1. ' },
  { icon: 'panelRight', label: '表格', hint: '/table · ⌘⇧T', keys: 'table 表格 快捷', insert: '| 列一 | 列二 |\n| --- | --- |\n|  |  |', cursor: 2 },
  { icon: 'book', label: '引用', hint: '/quote', keys: 'quote 引用', insert: '> ' },
  { icon: 'file', label: '代码块', hint: '/code', keys: 'code 代码', insert: '```ts\n\n```', cursor: 7 },
  { icon: 'sparkles', label: '数学公式', hint: '/math', keys: 'math latex 公式', insert: '$$\n\n$$', cursor: 3 },
  { icon: 'compass', label: 'Mermaid 图解', hint: '/mermaid', keys: 'mermaid 图表 图解', insert: '```mermaid\ngraph TD\n  A[开始] --> B[结束]\n```' },
  { icon: 'minus', label: '分割线', hint: '/hr', keys: 'hr 分割线', insert: '---' },
  { icon: 'sparkles', label: '让墨墨接着写', hint: '/ai', keys: 'ai 续写 墨墨', ai: 'continue' },
  { icon: 'pin', label: '总结这篇文档', hint: '/summary', keys: 'summary 总结', ai: 'summarize' },
  { icon: 'compass', label: '生成图解', hint: '/figure', keys: 'figure 图解 图表', ai: 'figure' },
  { icon: 'book', label: '打开今日笔记', hint: '/daily', keys: 'daily 今日 日记 笔记', action: 'daily' },
]

/** 长文在内部按段落切片润色；不限制用户输入，也不要求用户手动分章 */
function splitBodyForPolish(body: string, maxChars = 9000): string[] {
  const lines = body.split('\n')
  const chunks: string[] = []
  let buf: string[] = []
  let len = 0
  let inFence = false
  const flush = () => {
    const text = buf.join('\n').trim()
    if (text) chunks.push(text)
    buf = []
    len = 0
  }
  for (const line of lines) {
    const isFence = /^\s*(```|~~~)/.test(line)
    if (isFence) inFence = !inFence
    buf.push(line)
    len += line.length + 1
    if (len >= maxChars && !inFence && (!line.trim() || len >= maxChars * 1.5)) flush()
  }
  flush()
  return chunks.length ? chunks : [body]
}

const TABLE_MARKDOWN = '| 列一 | 列二 |\n| --- | --- |\n|  |  |'

/** 在光标处插入表格；光标在 Front Matter 时落到正文开头 */
function insertTableAt(view: EditorView) {
  const doc = view.state.doc
  const fm = parseFrontMatter(doc.toString())
  const bodyStart = doc.length - fm.body.length
  const sel = view.state.selection.main
  let from = sel.from
  let to = sel.to
  if (from < bodyStart) {
    from = bodyStart
    to = Math.max(bodyStart, to)
  }
  const line = doc.lineAt(from)
  const prefix = line.text.trim() && from === line.to ? '\n\n' : ''
  const insert = `${prefix}${TABLE_MARKDOWN}`
  const tableStart = from + prefix.length
  const cursor = tableStart + TABLE_MARKDOWN.indexOf('|  |  |') + 2
  view.dispatch({ changes: { from, to, insert }, selection: { anchor: cursor } })
  view.focus()
}

/** 去掉 Front Matter 后是否没有正文（用于空态提示，避免保存前闪一下墨墨） */
function isBlankBody(text: string): boolean {
  return !text.replace(/^---[\s\S]*?---\n?/, '').trim()
}

/** 选区气泡宽度按真实按钮数估算，窄窗口下不再半个气泡出屏 */
function clampBarCenter(center: number): number {
  const half = Math.min(178, Math.max(24, (window.innerWidth - 16) / 2))
  return Math.min(Math.max(center, half + 8), Math.max(half + 8, window.innerWidth - half - 8))
}

export const EditorPane = forwardRef<EditorHandle, Props>(function EditorPane(
  { doc, jumpTo, onOpenWiki, onOpenSource, onOpenVersions, outlineOpen, onToggleOutline, tabs, onSwitchTab, onCloseTab },
  ref,
) {
  const state = useVault()
  const { settings } = state
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const saveTimer = useRef<number>(0)
  const lastSaved = useRef<string>(doc.content)
  const latestText = useRef<string>(doc.content)
  const [savedAt, setSavedAt] = useState(doc.updatedAt)
  const [dirty, setDirty] = useState(false)
  const dirtyRef = useRef(false)
  const restoreAiRef = useRef<(id: string) => Promise<boolean>>(async () => false)
  const [cursor, setCursor] = useState({ line: 1, col: 1, chars: 0 })
  const [aiMenu, setAiMenu] = useState(false)
  const [slash, setSlash] = useState<{ from: number; to: number; query: string; x: number; y: number; index: number } | null>(null)
  const slashRef = useRef<HTMLDivElement | null>(null)
  const [customPrompt, setCustomPrompt] = useState('')
  const [suggestion, setSuggestion] = useState<AISuggestion | null>(null)
  const [selBar, setSelBar] = useState<{ x: number; y: number; text: string } | null>(null)
  const [blockEdit, setBlockEdit] = useState<BlockEditState | null>(null)
  const [cardDraft, setCardDraft] = useState<CardDraft | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [figureDraft, setFigureDraft] = useState<{ spec?: FigureSpec; loading?: boolean; error?: string; range: { from: number; to: number }; issues?: FigureIssue[] } | null>(null)
  const [figurePlan, setFigurePlan] = useState<{ loading?: boolean; error?: string; items?: { section: string; body: string; spec: FigureSpec; selected: boolean; busy?: boolean; issues?: FigureIssue[] }[] } | null>(null)
  const [cover, setCover] = useState<{ loading?: boolean; error?: string; dataUrl?: string; url?: string; blob?: Blob } | null>(null)
  const [coverEditPrompt, setCoverEditPrompt] = useState('')
  const [pixelIssues, setPixelIssues] = useState<FigureIssue[]>([])
  const figureAbort = useRef<AbortController | null>(null)
  const [empty, setEmpty] = useState(() => isBlankBody(doc.content))
  const sourceCompartment = useRef(new Compartment()).current
  const menuRef = useRef<HTMLDivElement | null>(null)
  const aiBtnRef = useRef<HTMLButtonElement | null>(null)
  const lastRunRef = useRef<{ mode: string; instruction?: string } | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const deltaBuf = useRef('')
  const deltaRaf = useRef(0)
  const selTimer = useRef(0)
  const selectingRef = useRef(false)
  const lastSelKey = useRef('')
  const readingTimer = useRef(0)
  const rustRev = useRef(0)
  const rustQueue = useRef<Promise<void>>(Promise.resolve())
  const frameRef = useRef(0)

  const headings = useMemo(() => extractHeadings(doc.content), [doc.content])
  const headingsRef = useRef(headings)
  headingsRef.current = headings

  const saveNow = useCallback(
    (text: string, immediate = false): Promise<boolean> => {
      window.clearTimeout(saveTimer.current)
      if (text === lastSaved.current) return Promise.resolve(false)
      const run = async () => {
        const saved = await vault.saveContent(doc.id, text)
        if (!saved) return false
        lastSaved.current = text
        setSavedAt(Date.now())
        dirtyRef.current = false
        setDirty(false)
        if (vault.state.settings.petLines) vault.pet('happy', '写好啦，真棒！✦', 2000)
        return true
      }
      if (immediate) return run()
      return new Promise((resolve) => {
        saveTimer.current = window.setTimeout(() => {
          void run()
            .then(resolve)
            .catch(() => resolve(false))
        }, vault.state.settings.autosaveMs)
      })
    },
    [doc.id],
  )

  const livePreviewExtensions = useCallback(
    () =>
      livePreview({
        resolvedTitles: () => new Set(vault.state.docs.map((d) => d.title.toLowerCase())),
        onEditTable: (payload: TableEditPayload) => setBlockEdit({ kind: 'table', ...payload }),
        onEditMermaid: (payload: MermaidEditPayload) => setBlockEdit({ kind: 'mermaid', ...payload }),
        onTocJump: (line: number) => {
          const v = viewRef.current
          if (!v) return
          const target = v.state.doc.line(Math.max(1, Math.min(line, v.state.doc.lines))).from
          v.dispatch({ selection: { anchor: target }, effects: EditorView.scrollIntoView(target, { y: 'center' }) })
          v.focus()
        },
      }),
    [settings.theme],
  )

  const buildExtensions = useCallback(
    (_text: string) =>
      [
        history(),
        drawSelection(),
        EditorView.lineWrapping,
        markdown({ codeLanguages: languages }),
        syntaxHighlighting(inkHighlight, { fallback: true }),
        keymap.of([
          {
            key: 'Mod-Shift-t',
            run: (view) => {
              insertTableAt(view)
              return true
            },
          },
          ...markdownKeymap,
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
          ...closeBracketsKeymap,
          indentWithTab,
        ]),
        closeBrackets(),
        ghostField,
        search({ top: true }),
        autocompletion({
          override: [
            (ctx: CompletionContext) => {
              const before = ctx.matchBefore(/\[\[([^\]\n]*)$/)
              if (!before) return null
              const q = before.text.slice(2).toLowerCase()
              const options = vault.state.docs
                .filter((d) => d.id !== doc.id && d.title.toLowerCase().includes(q))
                .slice(0, 12)
                .map((d) => ({ label: d.title, type: 'text', detail: d.path.split('/')[0] }))
              return { from: before.from + 2, options, validFor: /^[^\]\n]*$/ }
            },
          ],
        }),
        sourceCompartment.of(vault.state.settings.sourceMode ? [] : livePreviewExtensions()),
        EditorView.domEventHandlers({
          mousedown: (event) => {
            if (!(event.metaKey || event.ctrlKey)) return false
            const link = (event.target as HTMLElement).closest('[data-href]') as HTMLElement | null
            if (link) {
              event.preventDefault()
              const href = link.getAttribute('data-href')
              if (href) void platform.openExternal(href)
              return true
            }
            const el = (event.target as HTMLElement).closest('[data-wikilink]') as HTMLElement | null
            if (!el) return false
            const target = el.getAttribute('data-wikilink')
            if (target) {
              event.preventDefault()
              onOpenWiki(target)
              return true
            }
            return false
          },
          dblclick: (event) => {
            const el = (event.target as HTMLElement).closest('[data-wikilink]') as HTMLElement | null
            if (!el) return false
            const target = el.getAttribute('data-wikilink')
            if (target) {
              event.preventDefault()
              onOpenWiki(target)
              return true
            }
            return false
          },
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            const text = update.state.doc.toString()
            latestText.current = text
            if (isTauri) {
              const changes: { from: number; to: number; insert: string }[] = []
              update.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
                changes.push({ from: fromA, to: toA, insert: inserted.toString() })
              })
              if (changes.length) {
                rustQueue.current = rustQueue.current.then(async () => {
                  try {
                    const patch = await platform.docApply(doc.path, rustRev.current, changes)
                    rustRev.current = patch.revision
                    vault.setBlocks(doc.path, patch.blocks)
                  } catch {
                    try {
                      const text2 = viewRef.current?.state.doc.toString() ?? ''
                      const patch = await platform.docReset(doc.path, text2)
                      rustRev.current = patch.revision
                      vault.setBlocks(doc.path, patch.blocks)
                    } catch {
                      /* ignore */
                    }
                  }
                })
              }
            }
            setEmpty((prev) => {
              const next = text.trim().length === 0
              return prev === next ? prev : next
            })
            // 行首输入 / 唤出块命令；继续输入可作为过滤词
            {
              const head = update.state.selection.main.head
              const line = update.state.doc.lineAt(head)
              const before = update.state.sliceDoc(line.from, head)
              const match = before.match(/^\s*\/([^\s/]*)$/)
              if (match) {
                const from = line.from + before.lastIndexOf('/')
                const view = update.view
                requestAnimationFrame(() => {
                  const coords = view.coordsAtPos(head)
                  if (!coords) return
                  setSlash((prev) => {
                    const menuH = 348
                    const menuW = 312
                    const y = coords.bottom + menuH < window.innerHeight ? coords.bottom + 6 : Math.max(12, coords.top - menuH - 6)
                    return {
                      from,
                      to: head,
                      query: match[1],
                      x: Math.min(Math.max(12, coords.left), Math.max(12, window.innerWidth - menuW)),
                      y,
                      index: prev && prev.from === from && prev.query === match[1] ? prev.index : 0,
                    }
                  })
                })
              } else {
                setSlash((prev) => (prev ? null : prev))
              }
            }
            const nextDirty = text !== lastSaved.current
            if (nextDirty !== dirtyRef.current) {
              dirtyRef.current = nextDirty
              setDirty(nextDirty)
            }
            vault.noteTyping()
            saveNow(text)
          }
          if (update.selectionSet || update.docChanged) {
            // 让侧栏 AI 面板及时感知选区，不再靠 1.2s 轮询
            const sel = update.state.selection.main
            window.dispatchEvent(new CustomEvent('inkspire:selection', { detail: update.state.sliceDoc(sel.from, sel.to) }))
            // 选区气泡只在「松手/停顿」后出现，拖拽过程中不 setState，避免卡顿
            window.clearTimeout(selTimer.current)
            if (selectingRef.current) {
              setSelBar(null)
            } else {
              selTimer.current = window.setTimeout(() => {
                const v = viewRef.current
                if (!v) return
                const sel = v.state.selection.main
                if (sel.empty) {
                  lastSelKey.current = ''
                  setSelBar(null)
                  return
                }
                const picked = v.state.sliceDoc(sel.from, sel.to)
                const key = `${sel.from}:${sel.to}:${picked.slice(0, 24)}`
                if (!picked.trim() || picked.length > 3000) {
                  setSelBar(null)
                  return
                }
                if (key === lastSelKey.current) return
                const a = v.coordsAtPos(sel.from)
                const b = v.coordsAtPos(sel.to)
                if (!a || !b) return
                lastSelKey.current = key
                setSelBar({
                  x: clampBarCenter((a.left + b.right) / 2),
                  y: Math.max(64, Math.min(a.top, b.top) - 12),
                  text: picked,
                })
              }, update.docChanged ? 360 : 260)
            }
            const head = update.state.selection.main.head
            const line = update.state.doc.lineAt(head)
            const nextCursor = { line: line.number, col: head - line.from + 1, chars: update.state.doc.length }
            setCursor((prev) =>
              prev.line === nextCursor.line && prev.col === nextCursor.col && prev.chars === nextCursor.chars ? prev : nextCursor,
            )
            window.clearTimeout(readingTimer.current)
            readingTimer.current = window.setTimeout(() => {
              const hs = headingsRef.current
              const before = hs.filter((h) => h.line + 1 <= line.number)
              const section = before[before.length - 1]
              saveReading(doc.id, doc.title, line.number, {
                section: section?.text,
                sectionIndex: section ? before.length : 0,
                sectionsTotal: hs.length,
              })
            }, 1200)
            if (vault.state.settings.typewriter) {
              cancelAnimationFrame(frameRef.current)
              frameRef.current = requestAnimationFrame(() => {
                const view = viewRef.current
                if (view) view.dispatch({ effects: EditorView.scrollIntoView(head, { y: 'center' }) })
              })
            }
          }
        }),
        EditorView.theme({
          '&': { backgroundColor: 'transparent' },
          '.cm-content': { padding: '0' },
          '.cm-activeLine': { backgroundColor: 'transparent' },
          '&.cm-focused': { outline: 'none' },
        }),
        placeholder('开始写点什么… 输入 [[ 可以链接到另一篇笔记'),
      ].filter(Boolean) as any,
    [doc.id, onOpenWiki, saveNow, sourceCompartment, livePreviewExtensions],
  )

  // 打开/切换文档时创建编辑器
  useEffect(() => {
    if (!hostRef.current) return
    const initial = latestText.current || doc.content
    const view = new EditorView({
      state: EditorState.create({ doc: initial, extensions: buildExtensions(initial) }),
      parent: hostRef.current,
    })
    viewRef.current = view
    vault.discardPending = false
    if (import.meta.env.DEV) (window as any).__cmView = view
    lastSaved.current = doc.content
    setSavedAt(doc.updatedAt)
    setEmpty(isBlankBody(initial))
    dirtyRef.current = false
    setDirty(false)
    const lines = doc.content.split('\n').length
    setCursor({ line: 1, col: 1, chars: doc.content.length })
    void lines
    const onPointerDown = () => {
      selectingRef.current = true
      lastSelKey.current = ''
      window.clearTimeout(selTimer.current)
      setSelBar(null)
    }
    const onPointerUp = () => {
      if (!selectingRef.current) return
      selectingRef.current = false
      window.clearTimeout(selTimer.current)
      selTimer.current = window.setTimeout(() => {
        const v = viewRef.current
        if (!v) return
        const sel = v.state.selection.main
        if (sel.empty) return
        const picked = v.state.sliceDoc(sel.from, sel.to)
        if (!picked.trim() || picked.length > 3000) return
        const a = v.coordsAtPos(sel.from)
        const b = v.coordsAtPos(sel.to)
        if (!a || !b) return
        lastSelKey.current = `${sel.from}:${sel.to}:${picked.slice(0, 24)}`
        setSelBar({
          x: clampBarCenter((a.left + b.right) / 2),
          y: Math.max(64, Math.min(a.top, b.top) - 12),
          text: picked,
        })
      }, 120)
    }
    view.contentDOM.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointerup', onPointerUp)
    const readingClock = window.setInterval(() => {
      if (document.visibilityState === 'visible' && document.hasFocus()) addReadingSeconds(doc.id, doc.title, 15)
    }, 15_000)
    const lastRead = getReading(doc.id)
    if (lastRead && lastRead.line > 1 && Date.now() - lastRead.at > 30 * 60_000 && vault.state.settings.petLines) {
      const where = lastRead.section ? `「${lastRead.section}」` : `第 ${lastRead.line} 行`
      window.setTimeout(() => vault.pet('thinking', `上次读到 ${where}，接着看吗？`, 3000), 900)
    }
    const stale = staleCards(loadLearning().cards)
    if (stale.length && vault.state.settings.petLines) {
      window.setTimeout(() => vault.pet('surprised', `有 ${stale.length} 张卡快忘了，要复习吗？`, 3200), 1800)
    }
    view.focus()
    if (isTauri) {
      rustRev.current = 0
      void platform
        .docOpen(doc.path)
        .then((snap) => {
          rustRev.current = snap.revision
          vault.setBlocks(doc.path, snap.blocks)
        })
        .catch((e) => {
          console.warn('[ropey] open failed', e)
          vault.flash(`Rust 文档内核打开失败：${e?.message ?? e}`, 'error')
        })
    }
    const hideBar = () => setSelBar(null)
    view.scrollDOM.addEventListener('scroll', hideBar, { passive: true })
    return () => {
      view.contentDOM.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointerup', onPointerUp)
      window.clearTimeout(selTimer.current)
      window.clearTimeout(readingTimer.current)
      window.clearInterval(readingClock)
      view.scrollDOM.removeEventListener('scroll', hideBar)
      window.clearTimeout(saveTimer.current)
      const text = view.state.doc.toString()
      latestText.current = text
      if (!vault.discardPending && text !== lastSaved.current) void vault.saveContent(doc.id, text)
      view.destroy()
      viewRef.current = null
      if (import.meta.env.DEV) delete (window as any).__cmView
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.id])

  // 行内 / 源码切换只重配扩展，不重建 EditorView，撤销历史与滚动位置都保留
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({ effects: sourceCompartment.reconfigure(settings.sourceMode ? [] : livePreviewExtensions()) })
  }, [settings.sourceMode, livePreviewExtensions, sourceCompartment])

  useEffect(() => {
    if (!jumpTo) return
    const view = viewRef.current
    if (!view) return
    const fm = parseFrontMatter(view.state.doc.toString())
    const target = Math.min(view.state.doc.lines, jumpTo.line + 1 + fm.bodyLineOffset)
    const line = view.state.doc.line(target)
    view.dispatch({ selection: { anchor: line.from }, effects: EditorView.scrollIntoView(line.from, { y: 'center' }) })
    view.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpTo?.token])

  useEffect(() => () => {
    abortRef.current?.abort()
    figureAbort.current?.abort()
    coverAbort.current?.abort()
    if (deltaRaf.current) cancelAnimationFrame(deltaRaf.current)
  }, [])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const show = suggestion && !suggestion.error && suggestion.mode === 'continue' && suggestion.text.trim()
    if (!show) {
      view.dispatch({ effects: ghostEffect.of(null) })
      return
    }
    const from = suggestion.range?.from ?? view.state.selection.main.head
    const bodyStart = view.state.doc.length - parseFrontMatter(view.state.doc.toString()).body.length
    if (from < bodyStart) {
      view.dispatch({ effects: ghostEffect.of(null) })
      return
    }
    view.dispatch({ effects: ghostEffect.of({ from, text: suggestion.text }) })
  }, [suggestion?.text, suggestion?.error, suggestion?.mode, suggestion?.range?.from])



  // 图片点击放大：浮层不参与正文排版，Esc 或点击遮罩关闭
  useEffect(() => {
    const open = (event: Event) => setImagePreview(String((event as CustomEvent<string>).detail || ''))
    window.addEventListener('inkspire:image-preview', open)
    return () => window.removeEventListener('inkspire:image-preview', open)
  }, [])

  useEffect(() => {
    if (!imagePreview) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setImagePreview(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [imagePreview])

  useEffect(() => {
    if (!figureDraft?.spec) {
      setPixelIssues([])
      return
    }
    setPixelIssues([])
    const frame = requestAnimationFrame(() => {
      setPixelIssues(checkRenderedFigure(document.querySelector('.figure-preview-figure')))
    })
    return () => cancelAnimationFrame(frame)
  }, [figureDraft?.spec])

  useEffect(() => {
    if (!figurePlan?.items?.length) return
    saveFigurePlan(
      doc.id,
      figurePlan.items.map(({ busy: _busy, ...item }) => item),
    )
  }, [doc.id, figurePlan?.items])

  // 表格卡片：CM 会吞掉 widget 内的鼠标事件，这里在 document 捕获阶段接管
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement
      const toc = target?.closest?.('.cm-md-toc-item') as HTMLElement | null
      if (toc?.dataset.line) {
        e.preventDefault()
        const v = viewRef.current
        if (!v) return
        const line = Math.max(1, Math.min(Number(toc.dataset.line), v.state.doc.lines))
        const pos = v.state.doc.line(line).from
        v.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: 'center' }) })
        v.focus()
        return
      }
      const el = target?.closest?.('.cm-md-table-widget, .cm-md-mermaid') as any
      if (!el?.__inkspireEdit) return
      e.preventDefault()
      el.__inkspireEdit()
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [])

  useImperativeHandle(ref, () => ({
    getView: () => viewRef.current,
    getSelection: () => {
      const view = viewRef.current
      if (!view) return { from: 0, to: 0, text: '' }
      const { from, to } = view.state.selection.main
      return { from, to, text: view.state.sliceDoc(from, to) }
    },
    insertText: (text, opts) => {
      const view = viewRef.current
      if (!view) return
      const before = view.state.doc.toString()
      const at = view.state.selection.main.head
      view.dispatch({ changes: { from: at, insert: text }, selection: { anchor: at + text.length } })
      if (opts?.block) view.dispatch({ effects: EditorView.scrollIntoView(at, { y: 'center' }) })
      recordAiEdit(doc.id, 'AI 问答插入', before, view.state.doc.toString())
      view.focus()
    },
    replaceRange: (from, to, text) => {
      const view = viewRef.current
      if (!view) return
      view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length } })
      view.focus()
    },
    scrollToLine: (line, fmOffset = 0) => {
      const view = viewRef.current
      if (!view) return
      const target = Math.max(1, Math.min(view.state.doc.lines, line + 1 + fmOffset))
      const l = view.state.doc.line(target)
      view.dispatch({ selection: { anchor: l.from }, effects: EditorView.scrollIntoView(l.from, { y: 'center' }) })
      view.focus()
    },
    focus: () => viewRef.current?.focus(),
    flush: () => {
      const view = viewRef.current
      if (!view) return Promise.resolve(false)
      return saveNow(view.state.doc.toString(), true)
    },
    isDirty: () => dirtyRef.current,
    restoreAiEdit: (id) => restoreAiRef.current(id),
  }))

  const runAIRef = useRef<(mode: string, instruction?: string, opts?: { fresh?: boolean }) => Promise<void>>(async () => {})
  const runAI = async (mode: string, instruction?: string, opts: { fresh?: boolean } = {}) => {
    setAiMenu(false)
    lastRunRef.current = { mode, instruction }
    const view = viewRef.current
    if (!view) return
    const ai = settings.ai
    if (!ai.enabled) {
      vault.flash('先在设置里启用 AI 并填写接口信息', 'error')
      vault.setModal({ settingsOpen: true })
      return
    }
    if (settings.privacyLocalOnly && !isLocalProvider(ai.provider)) {
      vault.flash('隐私模式已开启：请切换到本地 Ollama / LM Studio，或关闭隐私模式', 'error')
      vault.setModal({ settingsOpen: true })
      return
    }
    if (needsApiKey(ai.provider) && !apiKeyFor(ai)) {
      const loaded = await vault.ensureProviderKey(ai.provider)
      if (!loaded) {
        vault.flash(`缺少 ${ai.provider} 的 API Key，请到设置里填写`, 'error')
        vault.setModal({ settingsOpen: true })
        return
      }
    }
    const readyAi = vault.state.settings.ai
    const sel = view.state.selection.main
    const selection = view.state.sliceDoc(sel.from, sel.to)
    if (mode === 'rewrite' && !selection.trim()) {
      vault.flash('先选中要改写的文字', 'error')
      return
    }
    if (mode === 'translate' && !selection.trim()) {
      vault.flash('先选中要翻译的段落', 'error')
      return
    }
    const full = view.state.doc.toString()
    const fm = parseFrontMatter(full)
    const bodyOffset = full.length - fm.body.length
    const relFrom = Math.max(0, sel.from - bodyOffset)
    const relTo = Math.max(relFrom, sel.to - bodyOffset)
    const budget = ai.contextChars || 6000
    if (!vault.checkAiBudget(budget + 500)) return
    const before = fm.body.slice(Math.max(0, relFrom - budget), relFrom)
    const after = fm.body.slice(relTo, relTo + Math.round(budget * 0.2))
    const related = findRelated(doc.id, selection || `${before}${after}`)
    const cursorLine = view.state.doc.lineAt(sel.from).number - 1
    const lineText = fm.body.split('\n')[Math.max(0, cursorLine - fm.bodyLineOffset)] ?? ''
    const sources: SourceRef[] = [
      { docId: doc.id, title: doc.title, line: Math.max(0, cursorLine - fm.bodyLineOffset), excerpt: lineText.trim().slice(0, 80) },
      ...related.map((r) => ({ docId: r.docId, title: r.title, line: r.line, excerpt: r.excerpt })),
    ]
    const messages = buildMessages(
      mode,
      {
        title: doc.title,
        headings: headings.map((h) => h.text),
        selection,
        before,
        after,
        related: related.map((r) => ({ title: r.title, excerpt: r.excerpt })),
        memories: loadMemories().map((m) => m.text),
        persona: settings.persona,
        budget,
      },
      instruction,
    )
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    vault.setAiBusy(true)
    vault.pet('thinking', '让我想想…', 0)
    setSuggestion({
      id: String(Date.now()),
      mode: mode as AISuggestion['mode'],
      title: MODE_LABEL[mode] ?? '建议',
      text: '',
      original: mode === 'rewrite' || mode === 'translate' ? selection : undefined,
      streaming: true,
      range: { from: sel.from, to: sel.to },
      sources,
    })
    try {
      const inputChars = JSON.stringify(messages).length
      const text = await streamChat(readyAi, messages, (delta) => {
        deltaBuf.current += delta
        if (!deltaRaf.current) {
          deltaRaf.current = requestAnimationFrame(() => {
            deltaRaf.current = 0
            const chunk = deltaBuf.current
            deltaBuf.current = ''
            if (!chunk) return
            setSuggestion((s) => (s ? { ...s, text: s.text + chunk } : s))
          })
        }
      }, controller.signal, { cache: !opts.fresh })
      vault.recordUsage(inputChars, text.length)
      setSuggestion((s) => (s ? { ...s, streaming: false } : s))
      vault.setAiBusy(false)
      vault.pet('happy', '写好啦，看看合不合心意', 2400)
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        vault.setAiBusy(false)
        return
      }
      setSuggestion((s) => (s ? { ...s, streaming: false, error: e?.message ?? String(e) } : s))
      vault.setAiBusy(false)
      vault.pet('surprised', '诶？！出错了', 2400)
    }
  }
  runAIRef.current = runAI

  const runDocPolishRef = useRef<() => Promise<void>>(async () => {})
  const runDocPolish = async () => {
    const view = viewRef.current
    if (!view) return
    const ai = settings.ai
    if (!ai.enabled) {
      vault.flash('先在设置里启用 AI 并填写接口信息', 'error')
      vault.setModal({ settingsOpen: true })
      return
    }
    if (settings.privacyLocalOnly && !isLocalProvider(ai.provider)) {
      vault.flash('隐私模式已开启：请切换到本地 Ollama / LM Studio，或关闭隐私模式', 'error')
      vault.setModal({ settingsOpen: true })
      return
    }
    if (needsApiKey(ai.provider) && !apiKeyFor(ai)) {
      const loaded = await vault.ensureProviderKey(ai.provider)
      if (!loaded) {
        vault.flash(`缺少 ${ai.provider} 的 API Key，请到设置里填写`, 'error')
        vault.setModal({ settingsOpen: true })
        return
      }
    }
    const full = view.state.doc.toString()
    const fm = parseFrontMatter(full)
    const body = fm.body
    if (!body.trim()) {
      vault.flash('正文为空，没有可润色的内容', 'info')
      return
    }
    const chunks = splitBodyForPolish(body)
    if (!vault.checkAiBudget(body.length + chunks.length * 700)) return
    const readyAi = vault.state.settings.ai
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    vault.setAiBusy(true)
    vault.pet('thinking', chunks.length > 1 ? `我先通读全文，分 ${chunks.length} 段处理…` : '我先通读一遍，再统一排版…', 0)
    setSuggestion({
      id: String(Date.now()),
      mode: 'rewrite',
      title: '全文润色排版',
      text: '',
      original: body,
      streaming: true,
      range: { from: full.length - body.length, to: full.length },
      sources: [{ docId: doc.id, title: doc.title, line: 0, excerpt: '整篇正文' }],
    })
    try {
      let acc = ''
      const push = (delta: string) => {
        acc += delta
        setSuggestion((s) => (s ? { ...s, text: acc } : s))
      }
      for (let i = 0; i < chunks.length; i++) {
        const budget = Math.max(readyAi.contextChars || 6000, Math.min(24_000, chunks[i].length + 800))
        const messages = buildMessages(chunks.length === 1 ? 'polish-doc' : 'polish-doc-chunk', {
          title: doc.title,
          headings: headings.map((h) => h.text),
          selection: chunks[i],
          before: '',
          after: '',
          memories: loadMemories().map((m) => m.text),
          persona: settings.persona,
          budget,
        })
        const before = acc.length
        await streamChat(readyAi, messages, push, controller.signal, { cache: false })
        if (controller.signal.aborted) return
        vault.recordUsage(JSON.stringify(messages).length, Math.max(0, acc.length - before))
        if (i < chunks.length - 1) {
          acc += acc.endsWith('\n\n') ? '' : '\n\n'
          setSuggestion((s) => (s ? { ...s, text: acc } : s))
          vault.pet('thinking', `已经处理 ${i + 1}/${chunks.length} 段…`, 0)
        }
      }
      setSuggestion((s) => (s ? { ...s, streaming: false } : s))
      vault.setAiBusy(false)
      vault.pet('happy', '全文排好了，确认 diff 再采纳', 2600)
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        vault.setAiBusy(false)
        return
      }
      setSuggestion((s) => (s ? { ...s, streaming: false, error: e?.message ?? String(e) } : s))
      vault.setAiBusy(false)
      vault.pet('surprised', '排版时出错了', 2400)
    }
  }
  runDocPolishRef.current = runDocPolish

  const runFigureRef = useRef<() => Promise<void>>(async () => {})
  const runFigure = async () => {
    const view = viewRef.current
    if (!view) return
    if (!vault.checkAiBudget(1600)) return
    const ai = settings.ai
    if (!ai.enabled) {
      vault.flash('先在设置里启用 AI', 'error')
      vault.setModal({ settingsOpen: true })
      return
    }
    if (settings.privacyLocalOnly && !isLocalProvider(ai.provider)) {
      vault.flash('隐私模式已开启：请切换到本地 Ollama / LM Studio，或关闭隐私模式', 'error')
      vault.setModal({ settingsOpen: true })
      return
    }
    if (needsApiKey(ai.provider) && !apiKeyFor(ai)) {
      const loaded = await vault.ensureProviderKey(ai.provider)
      if (!loaded) {
        vault.flash(`缺少 ${ai.provider} 的 API Key，请到设置里填写`, 'error')
        vault.setModal({ settingsOpen: true })
        return
      }
    }
    const readyAi = vault.state.settings.ai
    const sel = view.state.selection.main
    let source = view.state.sliceDoc(sel.from, sel.to).trim()
    if (!source) {
      const line = view.state.doc.lineAt(sel.head)
      const before = line.number > 1 ? view.state.doc.line(line.number - 1).text : ''
      const after = line.number < view.state.doc.lines ? view.state.doc.line(line.number + 1).text : ''
      source = `${before}\n${line.text}\n${after}`.trim()
    }
    if (!source) {
      vault.flash('先选中一段内容，或把光标放在要配图的段落', 'error')
      return
    }
    setAiMenu(false)
    figureAbort.current?.abort()
    const controller = new AbortController()
    figureAbort.current = controller
    const range = { from: sel.to, to: sel.to }
    if (readyAi.provider === 'demo') {
      setFigureDraft({
        range,
        spec: {
          version: 1,
          kind: 'flow',
          title: '从想法到落笔',
          focus: '先确认结构，再让 AI 补细节',
          nodes: [
            { label: '选中一段内容', detail: '或把光标放在目标段落' },
            { label: '生成图解建议', detail: '流程图 / 对比图' },
            { label: '确认后插入', detail: '以 figure 代码块保存，可继续改' },
          ],
          annotations: ['图内文字由代码排版，不交给图片模型'],
          takeaway: '提纲先确认，图才值得画',
        },
        issues: [],
      })
      return
    }
    setFigureDraft({ loading: true, range })
    try {
      const messages = [
        { role: 'system' as const, content: FIGURE_PROMPT },
        { role: 'user' as const, content: `把下面内容整理成一张图：\n\n${source.slice(0, 3000)}` },
      ]
      const raw = await streamChat(readyAi, messages, () => {}, controller.signal, { cache: true })
      vault.recordUsage(JSON.stringify(messages).length, raw.length)
      const spec = parseFigureResponse(raw)
      setFigureDraft({ spec, range, issues: validateFigure(spec, source) })
    } catch (e: any) {
      if (e?.name === 'AbortError') return
      setFigureDraft({ loading: false, error: e?.message ?? String(e), range })
    }
  }
  runFigureRef.current = runFigure

  const runDocumentPlan = async (force = false) => {
    const view = viewRef.current
    if (!view) return
    if (!vault.checkAiBudget(7000)) return
    const ai = settings.ai
    if (!ai.enabled) {
      vault.flash('先在设置里启用 AI', 'error')
      vault.setModal({ settingsOpen: true })
      return
    }
    if (settings.privacyLocalOnly && !isLocalProvider(ai.provider)) {
      vault.flash('隐私模式已开启：请切换到本地 Ollama / LM Studio，或关闭隐私模式', 'error')
      vault.setModal({ settingsOpen: true })
      return
    }
    if (needsApiKey(ai.provider) && !apiKeyFor(ai)) {
      const loaded = await vault.ensureProviderKey(ai.provider)
      if (!loaded) {
        vault.flash(`缺少 ${ai.provider} 的 API Key，请到设置里填写`, 'error')
        vault.setModal({ settingsOpen: true })
        return
      }
    }
    const readyAi = vault.state.settings.ai
    const full = view.state.doc.toString()
    const lines = full.split('\n')
    const headings = extractHeadings(full).filter((h) => h.level === 2)
    const sections = (headings.length ? headings : [{ level: 2, text: '全文', line: 0, offset: 0 }])
      .slice(0, 8)
      .map((h, i) => {
        const end = headings.length ? (headings[i + 1]?.line ?? lines.length) : lines.length
        const start = headings.length ? h.line + 1 : 0
        return { title: h.text, body: lines.slice(start, end).join('\n').slice(0, 1500) }
      })
      .filter((s) => s.body.trim())
    if (!sections.length) {
      vault.flash('没有找到可配图的章节', 'info')
      return
    }
    if (!force) {
      const saved = loadFigurePlan(doc.id)
      if (saved?.length) {
        setFigurePlan({ items: saved })
        vault.flash('已恢复上次未插入的提纲，可继续勾选或单节重生成', 'info')
        return
      }
    }
    setFigurePlan({ loading: true })
    const controller = new AbortController()
    figureAbort.current?.abort()
    figureAbort.current = controller
    try {
      if (readyAi.provider === 'demo') {
        setFigurePlan({
          items: sections.map((s, i) => ({
            section: s.title,
            body: s.body,
            selected: i < 2,
            issues: [],
            spec: {
              version: 1,
              kind: i % 2 === 0 ? 'flow' : 'compare',
              title: s.title.slice(0, 18),
              focus: '演示模式：确认提纲后再生成真实图解',
              nodes: [{ label: '现状' }, { label: '关键动作' }, { label: '结果' }],
              left: { title: '现状', items: ['手工整理'] },
              right: { title: '目标', items: ['结构化产出'] },
              takeaway: '先确认提纲，再画图',
            },
          })),
        })
        return
      }
      const content = sections.map((s) => `## ${s.title}\n${s.body}`).join('\n\n')
      const messages = [
        { role: 'system' as const, content: FIGURE_PLAN_PROMPT },
        { role: 'user' as const, content: `请为以下章节生成图解提纲：\n\n${content.slice(0, 7000)}` },
      ]
      const raw = await streamChat(readyAi, messages, () => {}, controller.signal, { cache: true })
      vault.recordUsage(JSON.stringify(messages).length, raw.length)
      const rows = parseFigurePlan(raw)
      if (!rows.length) throw new Error('模型没有给出可用的章节图解')
      setFigurePlan({
        items: rows.map((r) => {
          const issues = validateFigure(r.spec)
          return {
            ...r,
            body: sections.find((s) => s.title === r.section)?.body ?? '',
            selected: !issues.some((x) => x.level === 'error'),
            issues,
          }
        }),
      })
    } catch (e: any) {
      if (e?.name === 'AbortError') return
      setFigurePlan({ error: e?.message ?? String(e) })
    }
  }
  const runDocumentPlanRef = useRef<() => Promise<void>>(async () => {})
  runDocumentPlanRef.current = runDocumentPlan

  const coverAbort = useRef<AbortController | null>(null)
  const requestCover = async (prompt: string, reference?: string, keep = false) => {
    const view = viewRef.current
    if (!view) return
    const readyAi = vault.state.settings.ai
    const model = readyAi.imageModel || defaultImageModel(readyAi.provider)
    if (!model) throw new Error('当前服务商没有配置封面生图模型')
    coverAbort.current?.abort()
    const controller = new AbortController()
    coverAbort.current = controller
    setCover((prev) => (keep && prev ? { ...prev, loading: true, error: undefined } : { loading: true }))
    try {
      if (isTauri) {
        const result = await platform.aiImage({
          provider: readyAi.provider,
          baseUrl: readyAi.baseUrl,
          apiKey: apiKeyFor(readyAi) || (await vault.ensureProviderKey(readyAi.provider)),
          model,
          prompt,
          size: '1024x1024',
          image: reference,
        })
        if (controller.signal.aborted) return
        if (result.b64) setCover({ dataUrl: `data:image/png;base64,${result.b64}`, blob: dataUrlToBlob(`data:image/png;base64,${result.b64}`) })
        else if (result.url) setCover({ url: result.url })
        else throw new Error('生图响应为空')
      } else {
        const base = (readyAi.baseUrl || presetOf(readyAi.provider).baseUrl).replace(/\/$/, '')
        const dashscope = readyAi.provider === 'alibaba'
        const url = dashscope
          ? `${base.replace(/\/compatible-mode\/v1$/, '').replace(/\/compatible-mode$/, '')}/api/v1/services/aigc/multimodal-generation/generation`
          : `${base}/images/generations`
        const content = reference ? [{ image: reference }, { text: prompt }] : [{ text: prompt }]
        const payload = dashscope
          ? {
              model,
              input: { messages: [{ role: 'user', content }] },
              parameters: { size: '1024*1024', n: 1, response_format: 'b64_json', prompt_extend: true, watermark: false },
            }
          : { model, prompt, size: '1024x1024', n: 1, response_format: 'b64_json', prompt_extend: true, watermark: false }
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKeyFor(readyAi)}` },
          body: JSON.stringify(payload),
          signal: controller.signal,
        })
        if (!res.ok) throw new Error(`生图失败 (${res.status})：${(await res.text()).slice(0, 180)}`)
        const data: any = await res.json()
        let image = ''
        if (dashscope) {
          image = data?.output?.choices?.[0]?.message?.content?.find?.((x: any) => x?.image)?.image ?? ''
        } else {
          const item = data?.data?.[0]
          image = item?.b64_json ? `data:image/png;base64,${item.b64_json}` : item?.url ?? ''
        }
        if (image.startsWith('data:')) {
          setCover({ dataUrl: image, blob: dataUrlToBlob(image) })
        } else if (image) setCover({ url: image })
        else throw new Error('生图响应缺少图片')
      }
      recordCover(doc.id)
      vault.recordImageUsage({ model, images: 1, size: '1024', edited: !!reference })
    } catch (e: any) {
      if (e?.name === 'AbortError') return
      setCover((prev) => (keep && prev && (prev.dataUrl || prev.url) ? { ...prev, loading: false, error: e?.message ?? String(e) } : { error: e?.message ?? String(e) }))
    }
  }

  const runCover = async () => {
    const view = viewRef.current
    if (!view) return
    const ai = settings.ai
    if (!ai.enabled) {
      vault.flash('先在设置里启用 AI', 'error')
      vault.setModal({ settingsOpen: true })
      return
    }
    if (settings.privacyLocalOnly && !isLocalProvider(ai.provider)) {
      vault.flash('隐私模式已开启：请切换到本地 Ollama / LM Studio，或关闭隐私模式', 'error')
      vault.setModal({ settingsOpen: true })
      return
    }
    if (needsApiKey(ai.provider) && !apiKeyFor(ai)) {
      const loaded = await vault.ensureProviderKey(ai.provider)
      if (!loaded) {
        vault.flash(`缺少 ${ai.provider} 的 API Key，请到设置里填写`, 'error')
        vault.setModal({ settingsOpen: true })
        return
      }
    }
    if (ai.provider === 'demo') {
      vault.flash('演示模式不生成封面，请切到真实服务商', 'error')
      return
    }
    const readyAi = vault.state.settings.ai
    if (!(readyAi.imageModel || defaultImageModel(readyAi.provider))) {
      vault.flash('当前服务商没有配置封面生图模型', 'error')
      return
    }
    const budget = coverBudget(doc.id)
    if (!budget.ok) {
      vault.flash(budget.reason ?? '今日封面额度已用完', 'error')
      return
    }
    const sel = view.state.selection.main
    const picked = view.state.sliceDoc(sel.from, sel.to).trim()
    const body = parseFrontMatter(view.state.doc.toString()).body
    const source = (picked || body).replace(/\s+/g, ' ').slice(0, 1200)
    const prompt = `为文章《${doc.title}》生成一张编辑插画封面。内容主题：${source}。\n风格：暖纸底色，墨紫与珊瑚点缀，粗描边、硬阴影、手绘漫画感，留出标题空间；不要出现任何文字、字母、数字、水印或界面元素。`
    setCoverEditPrompt('')
    await requestCover(prompt)
  }

  const runCoverEdit = async () => {
    const view = viewRef.current
    if (!view || !cover || (!cover.dataUrl && !cover.url)) return
    const ai = vault.state.settings.ai
    if (ai.provider !== 'alibaba') {
      vault.flash('参考图编辑目前只支持阿里云百炼（qwen-image）', 'error')
      return
    }
    if (!ai.enabled) {
      vault.flash('先在设置里启用 AI', 'error')
      return
    }
    if (needsApiKey(ai.provider) && !apiKeyFor(ai) && !(await vault.ensureProviderKey(ai.provider))) {
      vault.flash('缺少 API Key，请到设置里填写', 'error')
      return
    }
    const edit = coverEditPrompt.trim()
    if (!edit) {
      vault.flash('先写一句修改要求，例如「把背景改成夜色」', 'error')
      return
    }
    const budget = coverBudget(doc.id)
    if (!budget.ok) {
      vault.flash(budget.reason ?? '今日封面额度已用完', 'error')
      return
    }
    let reference = cover.dataUrl
    if (!reference && cover.url) {
      const blob = await fetch(cover.url).then((r) => r.blob())
      reference = await new Promise<string | null>((resolve) => {
        const reader = new FileReader()
        reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null)
        reader.onerror = () => resolve(null)
        reader.readAsDataURL(blob)
      }) ?? undefined
    }
    if (!reference) {
      vault.flash('拿不到当前封面图，先重新生成一张', 'error')
      return
    }
    const prompt = `在参考图的基础上修改：${edit}。保持暖纸底色、墨紫与珊瑚点缀、粗描边、硬阴影、手绘漫画感；不要添加文字、字母、数字、水印或界面元素。`
    await requestCover(prompt, reference, true)
  }
  const runCoverRef = useRef<() => Promise<void>>(async () => {})
  runCoverRef.current = runCover

  const closeCover = () => {
    coverAbort.current?.abort()
    setCover(null)
  }

  const insertCover = async () => {
    if (!cover) return
    try {
      const blob = cover.blob ?? (cover.url ? await fetch(cover.url).then((r) => r.blob()) : null)
      if (!blob) throw new Error('没有可保存的图片')
      const path = `assets/covers/cover-${Date.now()}.png`
      await saveAsset(path, blob)
      const view = viewRef.current
      if (!view) return
      const full = view.state.doc.toString()
      const bodyStart = full.length - parseFrontMatter(full).body.length
      const line = view.state.doc.lineAt(bodyStart)
      const at = /^#\s+/.test(line.text) ? line.to : bodyStart
      const markdown = `\n\n![${doc.title} 封面](${path})\n`
      const beforeAi = full
      view.dispatch({ changes: { from: at, insert: markdown }, selection: { anchor: at + markdown.length } })
      recordAiEdit(doc.id, 'AI 插入封面', beforeAi, view.state.doc.toString())
      saveNow(view.state.doc.toString(), true)
      setCover(null)
      vault.flash('封面已保存到 assets/covers 并插入文档', 'success')
    } catch (e: any) {
      vault.flash(`保存封面失败：${e?.message ?? e}`, 'error')
    }
  }

  const downloadCover = async () => {
    if (!cover) return
    try {
      const blob = cover.blob ?? (cover.url ? await fetch(cover.url).then((r) => r.blob()) : null)
      if (!blob) throw new Error('没有可下载的图片')
      if (isTauri) {
        const path = await platform.saveExport(`cover-${Date.now()}.png`, blob)
        vault.flash(`已导出 ${path.split('/').slice(-2).join('/')}`, 'success')
      } else {
        downloadBlob(blob, `cover-${Date.now()}.png`)
        vault.flash('已下载封面 PNG', 'success')
      }
    } catch (e: any) {
      vault.flash(`下载封面失败：${e?.message ?? e}`, 'error')
    }
  }

  const closeFigurePlan = () => {
    figureAbort.current?.abort()
    setFigurePlan(null)
  }

  const retryPlanItem = async (index: number) => {
    const plan = figurePlan
    const item = plan?.items?.[index]
    if (!plan || !item || item.busy) return
    if (!vault.checkAiBudget(2600)) return
    const ai = vault.state.settings.ai
    if (!ai.enabled) {
      vault.flash('先在设置里启用 AI', 'error')
      return
    }
    if (needsApiKey(ai.provider) && !apiKeyFor(ai)) {
      const loaded = await vault.ensureProviderKey(ai.provider)
      if (!loaded) {
        vault.flash('还没有配置 API Key', 'error')
        return
      }
    }
    const readyAi = vault.state.settings.ai
    const controller = new AbortController()
    figureAbort.current?.abort()
    figureAbort.current = controller
    setFigurePlan((prev) =>
      prev ? { ...prev, items: prev.items?.map((x, i) => (i === index ? { ...x, busy: true } : x)) } : prev,
    )
    try {
      const messages = [
        { role: 'system' as const, content: FIGURE_PROMPT },
        { role: 'user' as const, content: `把这一节整理成一张图：\n\n${item.body.slice(0, 3000)}` },
      ]
      const raw = await streamChat(readyAi, messages, () => {}, controller.signal, { cache: false })
      const spec = parseFigureResponse(raw)
      const issues = validateFigure(spec, item.body)
      setFigurePlan((prev) =>
        prev
          ? {
              ...prev,
              items: prev.items?.map((x, i) =>
                i === index
                  ? { ...x, spec, issues, busy: false, selected: !issues.some((y) => y.level === 'error') }
                  : x,
              ),
            }
          : prev,
      )
    } catch (e: any) {
      if (e?.name === 'AbortError') return
      setFigurePlan((prev) =>
        prev ? { ...prev, items: prev.items?.map((x, i) => (i === index ? { ...x, busy: false } : x)) } : prev,
      )
      vault.flash(`这一节重生成失败：${e?.message ?? e}`, 'error')
    }
  }

  const insertFigurePlan = () => {
    const view = viewRef.current
    if (!view || !figurePlan?.items) return
    const chosen = figurePlan.items.filter((i) => i.selected && !(i.issues ?? []).some((x) => x.level === 'error'))
    if (!chosen.length) return
    const beforeAi = view.state.doc.toString()
    const cmDoc = view.state.doc
    const ops = chosen
      .map((item) => {
        for (let n = 1; n <= cmDoc.lines; n++) {
          const line = cmDoc.line(n)
          const m = line.text.match(/^##\s+(.+?)\s*$/)
          if (m?.[1].trim() === item.section.trim()) {
            let end = cmDoc.length
            for (let k = n + 1; k <= cmDoc.lines; k++) {
              if (/^#{1,2}\s+/.test(cmDoc.line(k).text)) {
                end = cmDoc.line(k).from
                break
              }
            }
            return { pos: end, md: figureMarkdown(item.spec) }
          }
        }
        if (item.section === '全文') return { pos: cmDoc.length, md: figureMarkdown(item.spec) }
        return null
      })
      .filter((x): x is { pos: number; md: string } => !!x)
      .sort((a, b) => b.pos - a.pos)
    for (const op of ops) view.dispatch({ changes: { from: op.pos, insert: op.md } })
    view.focus()
    const remaining = figurePlan.items
      .filter((item) => !chosen.includes(item))
      .map(({ busy: _busy, ...item }) => item)
    if (remaining.length) saveFigurePlan(doc.id, remaining)
    else clearFigurePlan(doc.id)
    recordAiEdit(doc.id, `AI 整篇配图（${ops.length} 张）`, beforeAi, view.state.doc.toString())
    setFigurePlan(null)
    saveNow(view.state.doc.toString(), true)
    vault.flash(`已插入 ${ops.length} 张图解，可逐张在源码模式调整`, 'success')
  }

  const closeFigure = () => {
    figureAbort.current?.abort()
    setFigureDraft(null)
  }

  const exportFigurePng = async () => {
    if (!figureDraft?.spec) return
    try {
      const { svg } = figureExportSvg(figureDraft.spec)
      const blob = await svgToPngBlob(svg, 2)
      const safe = figureDraft.spec.title.replace(/[\\/:*?"<>|]/g, ' ').trim().slice(0, 60) || 'figure'
      const name = `${safe}.png`
      if (isTauri) {
        const path = await platform.saveExport(name, blob)
        vault.flash(`已导出 ${path.split('/').slice(-2).join('/')}`, 'success')
      } else {
        downloadBlob(blob, name)
        vault.flash('已下载 2x PNG', 'success')
      }
    } catch (e: any) {
      vault.flash(`导出 PNG 失败：${e?.message ?? e}`, 'error')
    }
  }

  useEffect(() => {
    const insert = () => {
      const view = viewRef.current
      if (view) insertTableAt(view)
    }
    window.addEventListener('inkspire:insert-table', insert)
    return () => window.removeEventListener('inkspire:insert-table', insert)
  }, [])

  // 命令面板、AI 动作库和 ⌘J 都通过这个事件触发；长期缺失监听会变成「点了没反应」
  useEffect(() => {
    const onAI = (event: Event) => {
      const detail = (event as CustomEvent<{ mode?: string; instruction?: string }>).detail ?? {}
      if (detail.mode === 'figure') {
        void runFigureRef.current()
        return
      }
      if (detail.mode === 'figure-plan') {
        void runDocumentPlanRef.current()
        return
      }
      if (detail.mode === 'cover') {
        void runCoverRef.current()
        return
      }
      if (detail.mode === 'polish-doc') {
        void runDocPolishRef.current()
        return
      }
      if (detail.mode === 'undo-ai') {
        void undoAiRef.current()
        return
      }
      if (detail.mode === 'ai-log') {
        window.dispatchEvent(new Event('inkspire:ai-log'))
        return
      }
      void runAIRef.current(detail.mode || 'custom', detail.instruction)
    }
    window.addEventListener('inkspire:ai', onAI)
    return () => window.removeEventListener('inkspire:ai', onAI)
  }, [])

  useOutsideClose(aiMenu, [menuRef, aiBtnRef], () => setAiMenu(false))
  useOutsideClose(!!slash, [slashRef], () => setSlash(null))

  const slashMatches = useMemo(() => {
    const q = (slash?.query ?? '').toLowerCase()
    if (!q) return SLASH_ITEMS
    return SLASH_ITEMS.filter((item) => `${item.label} ${item.hint} ${item.keys}`.toLowerCase().includes(q))
  }, [slash?.query])

  const runSlash = (item: SlashItem) => {
    const view = viewRef.current
    if (!view || !slash) return
    const { from, to } = slash
    setSlash(null)
    if (item.action === 'daily') {
      view.dispatch({ changes: { from, to, insert: '' } })
      void vault.openDailyNote()
      return
    }
    if (item.ai) {
      view.dispatch({ changes: { from, to, insert: '' } })
      if (item.ai === 'figure') void runFigure()
      else void runAI(item.ai)
      return
    }
    const text = item.insert ?? ''
    view.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor: from + (item.cursor ?? text.length) },
    })
    view.focus()
  }

  useEffect(() => {
    if (!aiMenu) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setAiMenu(false)
        aiBtnRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    const first = menuRef.current?.querySelector<HTMLElement>('button')
    first?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [aiMenu])

  const acceptSuggestion = () => {
    const view = viewRef.current
    if (!view || !suggestion) return
    const text = suggestion.text.trim()
    if (!text) return
    const range = suggestion.range
    const full = view.state.doc.toString()
    const beforeAi = full
    const bodyStart = full.length - parseFrontMatter(full).body.length
    if ((suggestion.mode === 'rewrite' || suggestion.mode === 'translate') && range && range.to <= bodyStart) {
      vault.flash('建议不能写进 Front Matter，请把光标移到正文再试', 'error')
      return
    }
    if (suggestion.mode === 'rewrite' && range) {
      const from = Math.max(bodyStart, range.from)
      view.dispatch({ changes: { from, to: range.to, insert: text }, selection: { anchor: from + text.length } })
    } else if (suggestion.mode === 'translate' && range && range.to > range.from) {
      const from = Math.max(bodyStart, range.from)
      view.dispatch({ changes: { from, to: range.to, insert: text }, selection: { anchor: from + text.length } })
    } else {
      // 总结固定追加到末尾；续写/自定义落在光标处，光标在 Front Matter 时退到正文末尾
      const cursor = range?.from ?? view.state.selection.main.head
      const at = suggestion.mode === 'summarize' || cursor < bodyStart ? view.state.doc.length : cursor
      const block = suggestion.mode === 'summarize' ? `\n\n${text}\n\n` : `\n\n${text}`
      view.dispatch({ changes: { from: at, insert: block }, selection: { anchor: at + block.length } })
    }
    recordAiEdit(doc.id, suggestion.title === '全文润色排版' ? 'AI 全文润色排版' : `AI ${MODE_LABEL[suggestion.mode] ?? '写入'}`, beforeAi, view.state.doc.toString())
    setSuggestion(null)
    saveNow(view.state.doc.toString(), true)
    vault.pet('happy', '采纳啦！✦', 2000)
  }

  const restoreEntry = async (entry: AiEdit, removeFrom = false): Promise<boolean> => {
    const view = viewRef.current
    if (!view) return false
    const current = view.state.doc.toString()
    if (current !== entry.after) {
      const ok = await confirmDialog({
        title: removeFrom ? '回放到这次 AI 写入之前' : '撤销 AI 写入',
        message: `文档在「${entry.label}」之后又有改动。继续会回到那次写入前的内容。`,
        confirmText: removeFrom ? '仍然回放' : '仍然撤销',
        danger: true,
      })
      if (!ok) return false
    }
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: entry.before },
      selection: { anchor: 0 },
    })
    if (removeFrom) removeAiEditsFrom(doc.id, entry.at)
    else removeAiEdit(entry.id)
    saveNow(entry.before, true)
    vault.flash(`${removeFrom ? '已回放' : '已撤销'}：${entry.label}`, 'success')
    view.focus()
    return true
  }

  const undoAi = async () => {
    const entry = latestAiEdit(doc.id)
    if (!entry) {
      vault.flash('当前文档没有可撤销的 AI 写入', 'info')
      return
    }
    await restoreEntry(entry)
  }
  const undoAiRef = useRef<() => Promise<void>>(async () => {})
  undoAiRef.current = undoAi
  restoreAiRef.current = async (id) => {
    const entry = findAiEdit(id)
    if (!entry || entry.docId !== doc.id) return false
    return restoreEntry(entry, true)
  }

  const previewIssues = [...(figureDraft?.issues ?? []), ...pixelIssues]

  return (
    <div
      className="editor-col"
      onKeyDownCapture={(e) => {
        if (!slash) return
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          setSlash(null)
          return
        }
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          setSlash((s) => (s ? { ...s, index: Math.min(slashMatches.length - 1, s.index + 1) } : s))
          return
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault()
          setSlash((s) => (s ? { ...s, index: Math.max(0, s.index - 1) } : s))
          return
        }
        if (e.key === 'Enter') {
          e.preventDefault()
          const item = slashMatches[slash.index] ?? slashMatches[0]
          if (item) runSlash(item)
        }
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return
        if (suggestion) setSuggestion(null)
        else if (aiMenu) {
          setAiMenu(false)
          aiBtnRef.current?.focus()
        } else if (selBar) setSelBar(null)
        else if (figureDraft) closeFigure()
        else if (figurePlan) closeFigurePlan()
        else if (cover) closeCover()
      }}
    >
      {tabs.length > 1 && (
        <div className="doc-tabs" role="tablist" aria-label="打开的文档">
          {tabs.map((tab) => (
            <div key={tab.id} className={`doc-tab${tab.id === doc.id ? ' on' : ''}`}>
              <button
                type="button"
                role="tab"
                aria-selected={tab.id === doc.id}
                className="doc-tab-name"
                data-tip={tab.title}
                onClick={() => tab.id !== doc.id && onSwitchTab(tab.id)}
              >
                {tab.title}
              </button>
              <button type="button" className="doc-tab-close" aria-label={`关闭 ${tab.title}`} onClick={() => onCloseTab(tab.id)}>
                <Icon name="close" size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="editor-toolbar">
        <span className="chip path-chip" data-tip={doc.path}>{doc.path}</span>
        <span className="chip">{doc.wordCount.toLocaleString()} 字</span>
        <div className="spacer" />
        <button
          className={`chip clickable${settings.sourceMode ? ' active' : ''}`}
          onClick={() => void vault.updateSettings({ sourceMode: !settings.sourceMode })}
          data-tip="切换源码 / 行内渲染"
        >
          {settings.sourceMode ? '源码' : '行内'}
        </button>
        <button
          className={`chip clickable${settings.focusMode ? ' active' : ''}`}
          onClick={() => void vault.updateSettings({ focusMode: !settings.focusMode })}
          data-tip="专注模式"
        >
          <Icon name="focus" size={13} /> 专注
        </button>
        <button
          className={`chip clickable${settings.typewriter ? ' active' : ''}`}
          onClick={() => void vault.updateSettings({ typewriter: !settings.typewriter })}
          data-tip="打字机模式：光标始终居中"
        >
          <Icon name="typewriter" size={13} /> 打字机
        </button>
        <button className="chip clickable" onClick={onOpenVersions} data-tip="版本历史">
          <Icon name="history" size={13} /> 版本
        </button>
        <button className="chip clickable" onClick={onToggleOutline} data-tip="切换大纲">
          <Icon name="panelRight" size={13} /> 大纲
        </button>
        <button
          ref={aiBtnRef}
          className="chip clickable"
          onClick={() => setAiMenu((v) => !v)}
          data-tip="AI（⌘J 续写）"
          aria-haspopup="menu"
          aria-expanded={aiMenu}
        >
          <Icon name="sparkles" size={13} /> AI
        </button>
      </div>

      {aiMenu && (
        <div
          className="ai-menu"
          role="menu"
          ref={menuRef}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
            const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
            if (!items.length) return
            e.preventDefault()
            const at = items.indexOf(document.activeElement as HTMLButtonElement)
            const next = e.key === 'ArrowDown' ? Math.min(items.length - 1, at + 1) : Math.max(0, at <= 0 ? items.length - 1 : at - 1)
            items[next]?.focus()
          }}
        >
          {AI_MENU.map((item) => (
            <button key={item.label} type="button" role="menuitem" onClick={() => (item.mode === 'figure' ? runFigure() : item.mode === 'figure-plan' ? runDocumentPlan() : item.mode === 'cover' ? runCover() : item.mode === 'polish-doc' ? void runDocPolish() : item.mode === 'undo-ai' ? void undoAi() : item.mode === 'ai-log' ? window.dispatchEvent(new Event('inkspire:ai-log')) : void runAI(item.mode, item.instruction))}>
              <Icon name={item.icon} size={15} />
              <span>{item.label}</span>
            </button>
          ))}
          <div className="sep" />
          <div style={{ display: 'flex', gap: 6, padding: '4px 4px 2px' }}>
            <input
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              placeholder="自定义指令…"
              style={{ flex: 1, height: 30, border: '2px solid var(--line-soft)', borderRadius: 8, padding: '0 8px', fontSize: 12, background: 'var(--card)', outline: 'none' }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && customPrompt.trim()) {
                  void runAI('custom', customPrompt.trim())
                  setCustomPrompt('')
                }
              }}
            />
            <button
              onClick={() => {
                if (customPrompt.trim()) {
                  void runAI('custom', customPrompt.trim())
                  setCustomPrompt('')
                }
              }}
              style={{ fontWeight: 800, color: 'var(--brand)' }}
            >
              发送
            </button>
          </div>
        </div>
      )}

      {slash &&
        createPortal(
          <div className="slash-menu" ref={slashRef} style={{ left: slash.x, top: slash.y }} role="listbox" aria-label="插入块">
            <div className="slash-menu-head">插入块 · 继续输入可筛选</div>
            {slashMatches.map((item, i) => (
              <button
                key={item.label}
                type="button"
                role="option"
                aria-selected={i === slash.index}
                className={i === slash.index ? 'on' : ''}
                onMouseEnter={() => setSlash((s) => (s ? { ...s, index: i } : s))}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => runSlash(item)}
              >
                <Icon name={item.icon} size={15} />
                <span>
                  <b>{item.label}</b>
                  <em>{item.hint}</em>
                </span>
              </button>
            ))}
            {!slashMatches.length && <div className="slash-empty">没有匹配的块命令</div>}
          </div>,
          document.body,
        )}

      <div className="editor-scroll">
        {empty && <div className="editor-empty" style={{ pointerEvents: 'none', position: 'absolute', inset: 0, zIndex: 0 }}>
          <Momo mood="idle" className="big" />
          <div>这是一张空白的纸，墨墨在等你落笔。</div>
        </div>}
        <div className="editor-host" ref={hostRef} />
      </div>

      {cardDraft && (
        <CardEditor
          draft={cardDraft}
          onClose={() => setCardDraft(null)}
          onSave={(question, answer) => {
            addCard({ docId: cardDraft.docId, docTitle: cardDraft.docTitle, question, answer, source: cardDraft.source })
            setCardDraft(null)
            vault.pet('happy', '记住啦，之后我会来考你 ✦', 2600)
            vault.flash('已加入复习卡', 'success')
          }}
        />
      )}

      {blockEdit && (
        <BlockEditor
          value={blockEdit}
          onClose={() => setBlockEdit(null)}
          onSave={(markdown) => {
            const v = viewRef.current
            if (!v) return
            const from = Math.min(blockEdit.from, v.state.doc.length)
            const to = Math.min(blockEdit.to, v.state.doc.length)
            v.dispatch({ changes: { from, to, insert: markdown }, selection: { anchor: from + markdown.length } })
            v.focus()
            setBlockEdit(null)
            vault.flash('已写回文档', 'success')
          }}
        />
      )}

      {selBar && !suggestion && (
        <div className="ai-selection-bar" style={{ left: selBar.x, top: selBar.y }} onMouseDown={(e) => e.preventDefault()}>
          <Momo mood="happy" className="momo-mini" />
          <button onClick={() => { setSelBar(null); void runAI('rewrite') }}>润色</button>
          <button onClick={() => { setSelBar(null); void runAI('rewrite', '压缩到原文一半长度，保留关键信息') }}>精简</button>
          <button onClick={() => { setSelBar(null); void runAI('translate') }}>翻译</button>
          <button onClick={() => { setSelBar(null); void runAI('custom', '用简洁的中文解释这段文字的含义，并指出可能的歧义或问题。') }}>解释</button>
          <button onClick={() => { setSelBar(null); void runFigure() }} data-tip="把选中内容变成一张流程图或对比图">图解</button>
          <button
            data-tip="墨墨先问你四个问题，不直接给答案"
            onClick={() => {
              setSelBar(null)
              void runAI('custom', '请作为苏格拉底式学习伙伴，不要直接给结论。针对选中内容依次问我四层问题：1）这段话在陈述什么事实？2）它和我可能已有的知识有什么不同或联系？3）作者为什么这样说，依据是什么？4）我能提炼出什么自己的结论？每次只问一个问题，等我回答后再继续。')
            }}
          >
            追问
          </button>
          <button
            data-tip="把选中内容做成一张复习卡"
            onClick={() => {
              setSelBar(null)
              setCardDraft({ docId: doc.id, docTitle: doc.title, source: selBar.text, answer: selBar.text })
            }}
          >
            记住
          </button>
        </div>
      )}

      {suggestion && (
        <div className="ai-sheet">
          <div className="ai-sheet-head">
            <Momo mood={suggestion.streaming ? 'thinking' : 'happy'} className="momo-mini" />
            <span>墨墨 · {suggestion.title}</span>
            {suggestion.original && <span style={{ fontWeight: 600, opacity: 0.7 }}>（将替换选区）</span>}
            {suggestion.original && !suggestion.streaming && (
              <span className="ai-diff-stat">
                <b>+{suggestion.text.length}</b> / <em>-{suggestion.original.length}</em> 字符
              </span>
            )}
            <span className="grow" />
            {suggestion.streaming && <span style={{ fontSize: 10.5, fontWeight: 600 }}>生成中…</span>}
            <button onClick={() => { abortRef.current?.abort(); setSuggestion(null) }}>esc 关闭</button>
          </div>
          <div className="ai-body">
            {suggestion.original && suggestion.streaming && <span className="orig">{suggestion.original}</span>}
            {suggestion.original && !suggestion.streaming ? (
              <DiffView before={suggestion.original} after={suggestion.text} className="ai-diff" />
            ) : (
              <span className={suggestion.streaming ? 'ai-cursor' : ''}>{suggestion.text || '…'}</span>
            )}
            {suggestion.error && <div style={{ color: 'var(--coral-strong)', marginTop: 6 }}>{suggestion.error}</div>}
            {!!suggestion.sources?.length && (
              <div className="ai-sources">
                <span className="ai-sources-label">来源</span>
                {suggestion.sources.map((src, i) => (
                  <button
                    key={`${src.docId}-${i}`}
                    className="ai-source"
                    data-tip={src.excerpt}
                    onClick={() => {
                      onOpenSource(src.docId, src.line)
                      setSuggestion(null)
                    }}
                  >
                    {src.title} · L{src.line + 1}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="ai-actions">
            <button className="tbtn primary" disabled={suggestion.streaming || !suggestion.text.trim() || !!suggestion.error} onClick={acceptSuggestion}>
              <Icon name="check" size={15} /> 采纳
            </button>
            <button className="tbtn" onClick={() => setSuggestion(null)}>丢弃</button>
            <button
              className="tbtn ghost"
              onClick={() => {
                const last = lastRunRef.current
                if (!last) return
                setSuggestion(null)
                void runAI(last.mode, last.instruction, { fresh: true })
              }}
            >
              重试
            </button>
            <span className="hint">建议态不会自动写入，你点头它才落笔</span>
          </div>
        </div>
      )}

      {imagePreview &&
        createPortal(
          <div className="image-lightbox" onClick={() => setImagePreview(null)} role="dialog" aria-modal="true" aria-label="图片预览">
            <button type="button" className="image-lightbox-close" aria-label="关闭图片预览" onClick={() => setImagePreview(null)}>
              <Icon name="close" size={18} />
            </button>
            <img src={imagePreview} alt="" onClick={(e) => e.stopPropagation()} />
          </div>,
          document.body,
        )}

      {cover &&
        createPortal(
          <div className="modal-mask" onMouseDown={(e) => e.target === e.currentTarget && closeCover()}>
            <div className="modal cover-modal" role="dialog" aria-modal="true" aria-label="AI 封面预览">
              <div className="modal-head">
                <Momo mood={cover.loading ? 'thinking' : cover.error ? 'surprised' : 'happy'} className="momo-mini" />
                <h3>AI 封面 · {doc.title}</h3>
                <button className="close" onClick={() => closeCover()} aria-label="关闭封面预览">
                  <Icon name="close" size={16} />
                </button>
              </div>
              <div className="modal-body cover-preview-body">
                {cover.loading && <div className="figure-loading"><Momo mood="thinking" className="big" /><p>正在画封面，通常需要十几秒…</p></div>}
                {cover.error && <div className="figure-error"><b>封面没有生成</b><p>{cover.error}</p></div>}
                {(cover.dataUrl || cover.url) && <img src={cover.dataUrl || cover.url} alt={`${doc.title} 封面`} />}
              </div>
              <div className="cover-edit-bar">
                <input
                  value={coverEditPrompt}
                  onChange={(e) => setCoverEditPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !cover.loading) void runCoverEdit()
                  }}
                  placeholder={settings.ai.provider === 'alibaba' ? '修改要求：把背景改成夜色，保留纸张质感…' : '参考图编辑只支持阿里云百炼'}
                  aria-label="封面修改要求"
                  disabled={settings.ai.provider !== 'alibaba' || !!cover.loading || (!cover.dataUrl && !cover.url)}
                />
                <button
                  className="tbtn"
                  onClick={() => void runCoverEdit()}
                  disabled={settings.ai.provider !== 'alibaba' || !!cover.loading || !coverEditPrompt.trim() || (!cover.dataUrl && !cover.url)}
                  data-tip="只支持阿里云百炼；会再消耗 1 张封面额度"
                >
                  <Icon name="wand" size={15} /> 按这张修改
                </button>
              </div>
              <div className="modal-foot">
                <span>封面会保存到 `assets/covers/`，并在 H1 后插入图片引用 · 今日该文档还可生成 {coverBudget(doc.id).remaining} 张</span>
                <div className="right">
                  <button className="tbtn" onClick={() => closeCover()}>取消</button>
                  <button className="tbtn" onClick={() => void runCover()} disabled={!!cover.loading}>重新生成</button>
                  <button className="tbtn" onClick={() => void downloadCover()} disabled={!cover.dataUrl && !cover.url}>
                    <Icon name="download" size={15} /> 下载 PNG
                  </button>
                  <button className="tbtn primary" onClick={() => void insertCover()} disabled={!cover.dataUrl && !cover.url}>
                    <Icon name="check" size={15} /> 保存并插入
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {figurePlan &&
        createPortal(
          <div className="modal-mask" onMouseDown={(e) => e.target === e.currentTarget && closeFigurePlan()}>
            <div className="modal figure-plan-modal" role="dialog" aria-modal="true" aria-label="整篇配图提纲">
              <div className="modal-head">
                <Momo mood={figurePlan.loading ? 'thinking' : figurePlan.error ? 'surprised' : 'happy'} className="momo-mini" />
                <h3>整篇配图 · 视觉提纲</h3>
                <button className="close" onClick={() => closeFigurePlan()} aria-label="关闭配图提纲">
                  <Icon name="close" size={16} />
                </button>
              </div>
              <div className="modal-body">
                {figurePlan.loading && <div className="figure-loading"><Momo mood="thinking" className="big" /><p>正在按章节整理视觉提纲…</p></div>}
                {figurePlan.error && <div className="figure-error"><b>没有拿到可用提纲</b><p>{figurePlan.error}</p></div>}
                {!!figurePlan.items?.length && (
                  <div className="figure-plan-list">
                    {figurePlan.items.map((item, i) => {
                      const hasError = (item.issues ?? []).some((x) => x.level === 'error')
                      return (
                        <div key={`${item.section}-${i}`} className={`figure-plan-item${item.selected ? ' on' : ''}${hasError ? ' invalid' : ''}`}>
                          <Checkbox
                            checked={item.selected && !hasError}
                            ariaLabel={`为 ${item.section} 配图`}
                            onChange={(checked) =>
                              setFigurePlan((plan) =>
                                plan
                                  ? {
                                      ...plan,
                                      items: plan.items?.map((x, j) => (j === i ? { ...x, selected: checked } : x)),
                                    }
                                  : plan,
                              )
                            }
                          />
                          <div className="figure-plan-main">
                            <div className="figure-plan-title">
                              <span>{item.section}</span>
                              <em>{FIGURE_LABEL[item.spec.kind]}</em>
                              <button
                                type="button"
                                className="figure-plan-retry"
                                disabled={item.busy}
                                onClick={() => void retryPlanItem(i)}
                              >
                                {item.busy ? '生成中…' : '重生成'}
                              </button>
                            </div>
                            <b>{item.spec.title}</b>
                            {item.spec.focus && <p>{item.spec.focus}</p>}
                            {hasError ? (
                              <div className="figure-plan-issues">
                                {(item.issues ?? []).filter((x) => x.level === 'error').map((x, k) => <span key={k}>{x.message}</span>)}
                              </div>
                            ) : (item.issues ?? []).length > 0 ? (
                              <div className="figure-plan-issues warn">{(item.issues ?? [])[0].message}</div>
                            ) : null}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
              <div className="modal-foot">
                <span>先选图，再插入；有“必须修”的图不会写入</span>
                <div className="right">
                  <button className="tbtn" onClick={() => closeFigurePlan()}>取消</button>
                  <button className="tbtn" disabled={!!figurePlan.loading} onClick={() => void runDocumentPlan(true)}>重新生成全部</button>
                  <button className="tbtn primary" disabled={!figurePlan.items?.some((i) => i.selected) || !!figurePlan.loading} onClick={() => insertFigurePlan()}>
                    <Icon name="check" size={15} /> 插入选中的图解
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {figureDraft &&
        createPortal(
          <div className="modal-mask" onMouseDown={(e) => e.target === e.currentTarget && closeFigure()}>
            <div className="modal figure-preview-modal" role="dialog" aria-modal="true" aria-label="AI 图解预览">
              <div className="modal-head">
                <Momo mood={figureDraft.loading ? 'thinking' : figureDraft.error ? 'surprised' : 'happy'} className="momo-mini" />
                <h3>AI 图解 · {figureDraft.spec ? FIGURE_LABEL[figureDraft.spec.kind] : '生成中'}</h3>
                <button className="close" onClick={() => closeFigure()} aria-label="关闭图解预览">
                  <Icon name="close" size={16} />
                </button>
              </div>
              <div className="modal-body figure-preview-body">
                {figureDraft.loading && <div className="figure-loading"><Momo mood="thinking" className="big" /><p>正在把这段内容整理成图…</p></div>}
                {figureDraft.error && (
                  <div className="figure-error">
                    <b>这次没有生成合格的图</b>
                    <p>{figureDraft.error}</p>
                  </div>
                )}
                {figureDraft.spec && (
                  <div className="cm-md-figure figure-preview-figure">
                    <div className="cm-md-figure-body" dangerouslySetInnerHTML={{ __html: renderFigureSvg(figureDraft.spec) }} />
                  </div>
                )}
                {!!previewIssues.length && (
                  <div className="figure-issues">
                    <b>质量检查</b>
                    {previewIssues.map((issue, i) => (
                      <div key={i} className={issue.level}>
                        <span>{issue.level === 'error' ? '必须修' : '建议改'}</span>
                        {issue.message}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="modal-foot">
                <span>图规格会以 ```figure 代码块写入，随时可在源码模式修改</span>
                <div className="right">
                  <button className="tbtn" onClick={() => closeFigure()}>取消</button>
                  <button className="tbtn" onClick={() => void exportFigurePng()} disabled={!figureDraft.spec || !!figureDraft.loading}>
                    <Icon name="download" size={15} /> 导出 PNG
                  </button>
                  <button className="tbtn" onClick={() => void runFigure()} disabled={figureDraft.loading}>重新生成</button>
                  <button
                    className="tbtn primary"
                    disabled={!figureDraft.spec || !!figureDraft.loading || !!figureDraft.error || previewIssues.some((i) => i.level === 'error')}
                    onClick={() => {
                      const view = viewRef.current
                      if (!view || !figureDraft.spec) return
                      const md = figureMarkdown(figureDraft.spec)
                      const at = Math.min(figureDraft.range.from, view.state.doc.length)
                      const beforeAi = view.state.doc.toString()
                      view.dispatch({ changes: { from: at, insert: md }, selection: { anchor: at + md.length } })
                      recordAiEdit(doc.id, 'AI 插入图解', beforeAi, view.state.doc.toString())
                      setFigureDraft(null)
                      saveNow(view.state.doc.toString(), true)
                      vault.flash('已插入图解，可在源码模式继续改 JSON', 'success')
                    }}
                  >
                    <Icon name="check" size={15} /> 插入图解
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}

      <div className="statusbar">
        <span>{dirty ? '未保存…' : `已保存 · ${formatTime(savedAt)}`}</span>
        <span>行 {cursor.line}，列 {cursor.col}</span>
        <span>{(cursor.chars / 1000).toFixed(1)}k 字符</span>
        <div className="right">
          <span>{headings.length} 个标题</span>
          <span>{settings.sourceMode ? '源码模式' : '行内渲染'}</span>
          <span>⌘K 命令 · / 插入块 · ⌘⇧T 表格</span>
        </div>
      </div>
    </div>
  )
})
