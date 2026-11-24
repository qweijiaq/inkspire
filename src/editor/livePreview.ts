import { syntaxTree } from '@codemirror/language'
import katex from 'katex'
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate, WidgetType } from '@codemirror/view'
import { StateField, type EditorState, type Range } from '@codemirror/state'
import { FIGURE_LABEL, parseFigureBlock, renderFigureSvg } from '../lib/figures'
import { assetUrl } from '../lib/assets'

type Deco = Range<Decoration>

export interface TableEditPayload {
  from: number
  to: number
  rows: string[][]
  aligns: string[]
}

export interface MermaidEditPayload {
  from: number
  to: number
  code: string
}

interface Options {
  resolvedTitles?: () => Set<string>
  onEditTable?: (payload: TableEditPayload) => void
  onEditMermaid?: (payload: MermaidEditPayload) => void
  onTocJump?: (line: number) => void
}

/** 行内实时渲染：非活动行隐藏 Markdown 语法标记，活动行保持源码便于编辑 */
export function livePreview(opts: Options = {}) {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet

      constructor(view: EditorView) {
        this.decorations = build(view, opts)
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged || update.selectionSet) {
          this.decorations = build(update.view, opts)
        }
      }
    },
    {
      decorations: (v) => v.decorations,
    },
  )
  // 隐藏的语法标记作为原子区间：光标不会掉进 # / ** 里面，编辑不会破坏结构
  return [
    plugin,
    EditorView.atomicRanges.of((view) => view.plugin(plugin)?.decorations ?? Decoration.none),
    tableField(opts.onEditTable, opts.onEditMermaid, opts.onTocJump),
  ]
}

/** H2 编号只随文档内容变化重算；仅移动光标时复用上一次的扫描结果 */
const h2Cache = new WeakMap<object, { numbers: Map<number, number>; scanned: number }>()

function build(view: EditorView, opts: Options): DecorationSet {
  const decos: Deco[] = []
  const { state } = view
  const doc = state.doc

  const maxVisibleLine = Math.max(
    ...view.visibleRanges.map((range) => doc.lineAt(Math.min(range.to, doc.length)).number),
    1,
  )
  const cacheKey = doc as unknown as object
  let cache = h2Cache.get(cacheKey)
  if (!cache) {
    cache = { numbers: new Map(), scanned: 0 }
    h2Cache.set(cacheKey, cache)
  }
  while (cache.scanned < maxVisibleLine) {
    cache.scanned += 1
    if (/^##\s+/.test(doc.line(cache.scanned).text)) cache.numbers.set(cache.scanned, cache.numbers.size + 1)
  }
  const h2Numbers = cache.numbers

  const activeLines = new Set<number>()
  for (const r of state.selection.ranges) {
    const a = doc.lineAt(r.from).number
    const b = doc.lineAt(r.to).number
    for (let n = a; n <= b; n++) activeLines.add(n)
  }

  const codeLines = new Set<number>()
  for (const range of view.visibleRanges) {
    syntaxTree(state).iterate({
      from: range.from,
      to: range.to,
      enter: (node) => {
        if (node.name === 'FencedCode' || node.name === 'CodeBlock') {
          const a = doc.lineAt(node.from).number
          const b = doc.lineAt(node.to).number
          for (let n = a; n <= b; n++) codeLines.add(n)
        }
      },
    })
  }

  const resolved = opts.resolvedTitles?.()

  const firstLine = doc.line(1).text.trim()
  let fmEnd = 0
  if (firstLine === '---') {
    const limit = Math.min(doc.lines, 80)
    for (let n = 2; n <= limit; n++) {
      if (doc.line(n).text.trim() === '---') {
        fmEnd = n
        break
      }
    }
  }

  const handled = new Set<number>()
  for (const range of view.visibleRanges) {
    let pos = range.from
    while (pos <= range.to) {
      const line = doc.lineAt(pos)
      if (handled.has(line.number)) {
        pos = line.to + 1
        continue
      }
      handled.add(line.number)
      decorateLine(line, decos, false, codeLines.has(line.number), resolved, line.number <= fmEnd, line.number > 1 ? doc.line(line.number - 1).text : '', calloutKindAt(doc, line.number), codeLines.has(line.number - 1), codeLines.has(line.number + 1), line.number < doc.lines ? doc.line(line.number + 1).text : '', h2Numbers.get(line.number))
      pos = line.to + 1
    }
  }

  return Decoration.set(decos, true)
}

function calloutKindAt(doc: EditorState['doc'], lineNumber: number): string {
  for (let n = lineNumber - 1; n >= 1 && n > lineNumber - 40; n--) {
    const text = doc.line(n).text
    if (!/^\s*>/.test(text)) break
    const body = text.replace(/^\s*>\s?/, '')
    const kind = body.match(/^\[!(\w+)\]/)?.[1]
    if (kind) return kind
  }
  return ''
}

function decorateLine(
  line: { from: number; to: number; number: number; text: string },
  decos: Deco[],
  active: boolean,
  isCode: boolean,
  resolved?: Set<string>,
  isFrontMatter = false,
  prevText = '',
  inheritedCallout = '',
  prevIsCode = false,
  nextIsCode = false,
  nextText = '',
  h2Number?: number,
) {
  const text = line.text
  const add = (from: number, to: number, value: Decoration) => decos.push(value.range(line.from + from, line.from + to))
  const addLine = (cls: string) => decos.push(Decoration.line({ class: cls }).range(line.from))
  if (isFrontMatter) {
    addLine(text.trim() === '---' ? 'cm-md-fm cm-md-fm-rule' : 'cm-md-fm')
    return
  }

  if (isCode) {
    const fence = text.match(/^\s*(```|~~~)\s*([\w+#.-]*)/)
    if (fence) {
      const isOpen = !prevIsCode
      if (isOpen) {
        decos.push(
          Decoration.line({
            class: 'cm-md-codeblock cm-md-code-open',
            attributes: { 'data-lang': (fence[2] || 'code').toLowerCase() },
          }).range(line.from),
        )
      } else {
        addLine('cm-md-codeblock cm-md-code-close')
      }
      if (!active) add(0, text.length, Decoration.replace({}))
    } else {
      addLine(`cm-md-codeblock${(!nextIsCode || /^\s*(```|~~~)/.test(nextText)) ? ' cm-md-code-last' : ''}`)
    }
    return
  }

  if (!text.trim()) {
    addLine('cm-md-blank')
    return
  }

  const fnDef = text.match(/^\s*\[\^([^\]]+)\]:\s*/)
  if (fnDef) {
    addLine('cm-md-footnote-def')
    if (!active) add(0, fnDef[0].length, Decoration.replace({}))
    return
  }
  if (/^\s*:\s+/.test(text)) {
    addLine('cm-md-def')
    const m = text.match(/^\s*:\s+/)?.[0].length ?? 0
    if (!active) add(0, m, Decoration.replace({}))
    return
  }
  if (/^\s*:\s+/.test(nextText)) addLine('cm-md-def-term')

  // 列表项行本身不能当 setext 下划线；否则空的 `- ` 会把上一行列表项变成标题
  const isListLine = /^\s*(?:[-*+]|\d+[.)])\s+/.test(text)
  const isPrevListLine = /^\s*(?:[-*+]|\d+[.)])\s+/.test(prevText)
  if ((/^=+\s*$/.test(text) || /^-{3,}\s*$/.test(text)) && !isListLine) {
    if (prevText.trim() && !isPrevListLine) {
      addLine('cm-md-setext-rule')
      if (!active) add(0, text.length, Decoration.replace({}))
      return
    }
  }
  if (/^=+\s*$/.test(nextText)) addLine('cm-md-h1-setext')
  else if (/^-{3,}\s*$/.test(nextText) && !isListLine) addLine('cm-md-h2-setext')

  const heading = text.match(/^(#{1,6})\s+/)
  if (heading) {
    const level = heading[1].length
    if (level === 2 && h2Number) {
      decos.push(Decoration.line({ class: 'cm-md-h2', attributes: { 'data-h2': String(h2Number) } }).range(line.from))
    } else {
      addLine(`cm-md-h${level}`)
    }
    if (!active) add(0, heading[0].length, Decoration.replace({}))
    const hid = text.match(/\s*\{#[^}]+\}\s*$/)
    if (hid && !active) add(hid.index ?? 0, text.length, Decoration.replace({}))
  }

  const quote = text.match(/^(\s*(?:>\s?)+)/)
  if (quote) {
    const marker = text.match(/^>\s*\[!(tip|note|warn|warning|info|danger)\]/i)
    const markerKind = marker ? marker[1].toLowerCase().replace('warning', 'warn') : ''
    const kind = markerKind || inheritedCallout
    if (kind) {
      const isEnd = !/^\s*>/.test(nextText)
      addLine(`cm-md-callout cm-md-callout-${kind}${markerKind ? ' cm-md-quote-start cm-md-callout-first' : ''}${isEnd ? ' cm-md-callout-last' : ''}`)
      const len = marker ? marker[0].length : quote[1].length
      if (!active) add(0, len, Decoration.replace({}))
      else add(0, len, Decoration.mark({ class: 'cm-md-marker' }))
    } else {
      const isStart = !/^\s*>/.test(prevText)
      const isEnd = !/^\s*>/.test(nextText)
      addLine(`cm-md-quote${isStart ? ' cm-md-quote-start cm-md-quote-first' : ''}${isEnd ? ' cm-md-quote-last' : ''}`)
      if (!active) add(0, quote[1].length, Decoration.replace({}))
      else add(0, quote[1].length, Decoration.mark({ class: 'cm-md-marker' }))
    }
  }

  if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(text)) {
    addLine('cm-md-hr')
    add(0, text.length, Decoration.replace({}))
    decos.push(Decoration.widget({ widget: new HrWidget(), side: 1 }).range(line.from + text.length))
    return
  }

  if (/^\s*\|.*\|\s*$/.test(text)) addLine('cm-md-table')

  const list = text.match(/^(\s*)([-*+]|\d+[.)])\s+/)
  let inlineStart = 0
  if (list) {
    const visualIndent = list[1].replace(/\t/g, '  ').length
    const indent = Math.min(3, Math.floor(visualIndent / 2))
    if (/^[-*+]$/.test(list[2])) {
      if (!active) add(0, list[0].length, Decoration.replace({}))
      addLine(`cm-md-list cm-md-list-${indent}`)
    } else {
      add(list[0].length - 1, list[0].length, Decoration.mark({ class: 'cm-md-marker' }))
      addLine(`cm-md-list-ol cm-md-list-${indent}`)
    }
    inlineStart = list[0].length
    if (!active) {
      // 任务列表：把 [ ] / [x] 变成彩色字符
      const task = text.slice(inlineStart).match(/^\[([ xX])\]\s/)
      if (task) add(inlineStart, inlineStart + task[0].length - 1, Decoration.mark({ class: 'cm-md-task' }))
    }
  }

  const occupied: { from: number; to: number }[] = []
  const overlaps = (from: number, to: number) => occupied.some((o) => from < o.to && to > o.from)

  const addReplace = (from: number, to: number) => {
    if (from >= to || overlaps(from, to)) return false
    occupied.push({ from, to })
    add(from, to, Decoration.replace({}))
    return true
  }
  const addMark = (from: number, to: number, cls: string, attrs?: Record<string, string>) => {
    if (from >= to) return
    add(from, to, Decoration.mark({ class: cls, attributes: attrs }))
  }

  const rest = text.slice(inlineStart)
  let m: RegExpExecArray | null

  // 图片 / 链接
  const linkRe = /(!?)\[([^\]\n]*)\]\(([^)\n]+)\)/g
  while ((m = linkRe.exec(rest))) {
    const from = inlineStart + m.index
    const to = from + m[0].length
    const labelStart = from + m[1].length + 1
    const labelEnd = labelStart + m[2].length
    if (overlaps(from, to)) continue
    if (m[1]) {
      const src = m[3]
      if (!active && (src.startsWith('assets/') || /^(https?:|data:image\/)/.test(src))) {
        occupied.push({ from, to })
        decos.push(Decoration.replace({ widget: new ImageWidget(src, m[2]) }).range(line.from + from, line.from + to))
      } else {
        addMark(from, to, 'cm-md-link')
      }
    } else {
      addMark(labelStart, labelEnd, 'cm-md-link', { 'data-href': m[3] })
      if (!active) {
        addReplace(from, labelStart)
        addReplace(labelEnd, to)
      }
    }
  }

  // Wiki 双链
  const wikiRe = /\[\[([^\]\n]+?)\]\]/g
  while ((m = wikiRe.exec(rest))) {
    const from = inlineStart + m.index
    const to = from + m[0].length
    if (overlaps(from, to)) continue
    const target = m[1].split('|')[0].split('#')[0].trim()
    const isResolved = !resolved || resolved.has(target.toLowerCase())
    addMark(from, to, `cm-md-wikilink${isResolved ? '' : ' unresolved'}`, { 'data-wikilink': target })
    if (!active) {
      addReplace(from, from + 2)
      addReplace(to - 2, to)
    }
  }

  // 粗斜体（***text*** / ___text___）
  const boldItalicRe = /(\*\*\*|___)([^*_\n]+?)\1/g
  while ((m = boldItalicRe.exec(rest))) {
    const from = inlineStart + m.index
    const to = from + m[0].length
    if (overlaps(from, to)) continue
    addMark(from + 3, to - 3, 'cm-md-bold cm-md-italic')
    if (!active) {
      addReplace(from, from + 3)
      addReplace(to - 3, to)
    }
  }

  // 粗体（**text** / __text__）
  const boldRe = /(\*\*|__)([^*_\n]+?)\1/g
  while ((m = boldRe.exec(rest))) {
    const from = inlineStart + m.index
    const to = from + m[0].length
    if (overlaps(from, to)) continue
    addMark(from + 2, to - 2, 'cm-md-bold')
    if (!active) {
      addReplace(from, from + 2)
      addReplace(to - 2, to)
    }
  }

  // 删除线
  const strikeRe = /~~([^~\n]+?)~~/g
  while ((m = strikeRe.exec(rest))) {
    const from = inlineStart + m.index
    const to = from + m[0].length
    if (overlaps(from, to)) continue
    addMark(from + 2, to - 2, 'cm-md-strike')
    if (!active) {
      addReplace(from, from + 2)
      addReplace(to - 2, to)
    }
  }

  // 高亮 ==text==
  const markRe = /==([^=\n]+?)==/g
  while ((m = markRe.exec(rest))) {
    const from = inlineStart + m.index
    const to = from + m[0].length
    if (overlaps(from, to)) continue
    addMark(from + 2, to - 2, 'cm-md-highlight')
    if (!active) {
      addReplace(from, from + 2)
      addReplace(to - 2, to)
    }
  }

  // 上标 ^text^
  const supRe = /\^([^^\n]+?)\^/g
  while ((m = supRe.exec(rest))) {
    const from = inlineStart + m.index
    const to = from + m[0].length
    if (overlaps(from, to)) continue
    addMark(from + 1, to - 1, 'cm-md-sup')
    if (!active) {
      addReplace(from, from + 1)
      addReplace(to - 1, to)
    }
  }

  // 下标 ~text~（避开 ~~删除线~~）
  const subRe = /(?<!~)~([^~\n]+?)~(?!~)/g
  while ((m = subRe.exec(rest))) {
    const from = inlineStart + m.index
    const to = from + m[0].length
    if (overlaps(from, to)) continue
    addMark(from + 1, to - 1, 'cm-md-sub')
    if (!active) {
      addReplace(from, from + 1)
      addReplace(to - 1, to)
    }
  }

  // 脚注引用 [^id]
  const fnRefRe = /\[\^([^\]\n]+)\]/g
  while ((m = fnRefRe.exec(rest))) {
    const from = inlineStart + m.index
    const to = from + m[0].length
    if (overlaps(from, to)) continue
    addMark(from, to, 'cm-md-footnote-ref', { 'data-fn': m[1] })
    if (!active) {
      addReplace(from, from + 2)
      addReplace(to - 1, to)
    }
  }

  // 裸链接
  const bareRe = /(^|[\s(])(https?:\/\/[^\s<)]+)/g
  while ((m = bareRe.exec(rest))) {
    const start = inlineStart + m.index + m[1].length
    const to = start + m[2].length
    if (overlaps(start, to)) continue
    addMark(start, to, 'cm-md-link', { 'data-href': m[2] })
  }

  // HTML 行内：kbd
  const kbdRe = /<kbd>([^<\n]+?)<\/kbd>/gi
  while ((m = kbdRe.exec(rest))) {
    const from = inlineStart + m.index
    const to = from + m[0].length
    if (overlaps(from, to)) continue
    addMark(from + 5, to - 6, 'cm-md-kbd')
    if (!active) {
      addReplace(from, from + 5)
      addReplace(to - 6, to)
    }
  }

  // Emoji shortcode
  const emojiRe = /:([a-z0-9_+-]+):/g
  while ((m = emojiRe.exec(rest))) {
    const ch = EMOJI[m[1]]
    if (!ch) continue
    const from = inlineStart + m.index
    const to = from + m[0].length
    if (overlaps(from, to)) continue
    if (!active) {
      occupied.push({ from, to })
      decos.push(Decoration.replace({ widget: new EmojiWidget(ch) }).range(line.from + from, line.from + to))
    }
  }

  // 行内代码
  const codeRe = /`([^`\n]+)`/g
  while ((m = codeRe.exec(rest))) {
    const from = inlineStart + m.index
    const to = from + m[0].length
    if (overlaps(from, to)) continue
    addMark(from + 1, to - 1, 'cm-md-inline-code')
    if (!active) {
      addReplace(from, from + 1)
      addReplace(to - 1, to)
    }
  }

  // 斜体（*text* / _text_）
  const italicRe = /(?<![\w*_])([*_])([^*_\n]+?)\1(?![\w*_])/g
  while ((m = italicRe.exec(rest))) {
    const from = inlineStart + m.index
    const to = from + m[0].length
    if (overlaps(from, to)) continue
    addMark(from + 1, to - 1, 'cm-md-italic')
    if (!active) {
      addReplace(from, from + 1)
      addReplace(to - 1, to)
    }
  }

  // 行内公式 $...$
  const mathRe = /(?<!\$)\$([^$\n]+?)\$(?!\$)/g
  while ((m = mathRe.exec(rest))) {
    const from = inlineStart + m.index
    const to = from + m[0].length
    if (overlaps(from, to)) continue
    if (!active) {
      occupied.push({ from, to })
      decos.push(Decoration.replace({ widget: new MathWidget(m[1]) }).range(line.from + from, line.from + to))
    } else {
      addMark(from, to, 'cm-md-marker')
    }
  }

  // 引用中的提示卡语法
  if (quote) {
    const callout = text.match(/^>\s*\[!(tip|note|warn|warning|info|danger)\]/i)
    if (callout) add(0, callout[0].length, Decoration.mark({ class: 'cm-md-marker' }))
  }
}


function tableField(onEditTable?: (payload: TableEditPayload) => void, onEditMermaid?: (payload: MermaidEditPayload) => void, onTocJump?: (line: number) => void) {
  const build = (state: EditorState): DecorationSet => {
    const decos: Range<Decoration>[] = []
    let n = 1
    let mermaidSeq = 0
    let plainFence: string | null = null
    while (n <= state.doc.lines) {
      const line = state.doc.line(n)
      if (plainFence) {
        if (line.text.trim().startsWith(plainFence)) plainFence = null
        n++
        continue
      }
      const anyFence = line.text.match(/^\s*(```|~~~)(.*)$/)
      if (anyFence && !/^\s*(mermaid|figure)\s*$/i.test(anyFence[2])) {
        plainFence = anyFence[1]
        n++
        continue
      }
      const figureFence = line.text.match(/^\s*(```|~~~)\s*figure\s*$/i)
      if (figureFence) {
        const mark = figureFence[1]
        const code: string[] = []
        let last = line
        let k = n + 1
        while (k <= state.doc.lines) {
          const cur = state.doc.line(k)
          if (new RegExp(`^\\s*${mark}`).test(cur.text)) {
            last = cur
            break
          }
          code.push(cur.text)
          last = cur
          k++
        }
        if (last.number > n) {
          decos.push(
            Decoration.replace({
              block: true,
              widget: new FigureWidget(code.join('\n')),
            }).range(line.from, last.to),
          )
          n = last.number + 1
          continue
        }
      }
      const fence = line.text.match(/^\s*(```|~~~)\s*mermaid\s*$/i)
      if (fence) {
        const mark = fence[1]
        const code: string[] = []
        let last = line
        let k = n + 1
        while (k <= state.doc.lines) {
          const cur = state.doc.line(k)
          if (new RegExp(`^\\s*${mark}`).test(cur.text)) {
            last = cur
            break
          }
          code.push(cur.text)
          last = cur
          k++
        }
        if (last.number > n) {
          decos.push(
            Decoration.replace({
              block: true,
              widget: new MermaidWidget(code.join('\n'), line.from, last.to, `mmd-${mermaidSeq++}`, onEditMermaid),
            }).range(line.from, last.to),
          )
          n = last.number + 1
          continue
        }
      }
      const oneLineMath = line.text.match(/^\s*\$\$(.+?)\$\$\s*$/)
      if (oneLineMath) {
        decos.push(Decoration.replace({ block: true, widget: new BlockMathWidget(oneLineMath[1]) }).range(line.from, line.to))
        n++
        continue
      }
      if (line.text.trim() === '$$') {
        const body: string[] = []
        let last = line
        let k = n + 1
        while (k <= state.doc.lines) {
          const cur = state.doc.line(k)
          if (cur.text.trim() === '$$') {
            last = cur
            break
          }
          body.push(cur.text)
          last = cur
          k++
        }
        if (last.number > n && last.text.trim() === '$$') {
          decos.push(Decoration.replace({ block: true, widget: new BlockMathWidget(body.join('\n')) }).range(line.from, last.to))
          n = last.number + 1
          continue
        }
      }
      if (line.text.trim() === '[TOC]') {
        const headings: { level: number; text: string; line: number }[] = []
        let inFence = false
        for (let i = 1; i <= state.doc.lines; i++) {
          const t = state.doc.line(i).text
          if (/^\s*(```|~~~)/.test(t)) {
            inFence = !inFence
            continue
          }
          if (inFence) continue
          const h = t.match(/^(#{1,6})\s+(.+)$/)
          if (h) headings.push({ level: h[1].length, text: h[2].replace(/\s*\{#[^}]+\}\s*$/, ''), line: i })
        }
        decos.push(
          Decoration.replace({ block: true, widget: new TocWidget(headings, onTocJump) }).range(line.from, line.to),
        )
        n++
        continue
      }
      if (!/^\s*\|.*\|\s*$/.test(line.text)) {
        n++
        continue
      }
      const next = n < state.doc.lines ? state.doc.line(n + 1) : null
      if (!next || !/^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(next.text) || !next.text.includes('-')) {
        n++
        continue
      }
      const rows: string[][] = [splitRow(line.text)]
      let aligns: string[] = []
      let last = next
      let k = n + 1
      while (k <= state.doc.lines) {
        const cur = state.doc.line(k)
        if (!/^\s*\|.*\|\s*$/.test(cur.text)) break
        if (k === n + 1) {
          aligns = splitRow(cur.text).map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : c.startsWith(':') ? 'left' : ''))
        } else {
          rows.push(splitRow(cur.text))
        }
        last = cur
        k++
      }
      if (rows.length) {
        decos.push(
          Decoration.replace({
            block: true,
            widget: new TableWidget(rows, aligns, line.from, last.to, onEditTable),
          }).range(line.from, last.to),
        )
      }
      n = k
    }
    return Decoration.set(decos, true)
  }
  return StateField.define<DecorationSet>({
    create: (state) => build(state),
    update: (deco, tr) => (tr.docChanged ? build(tr.state) : deco),
    provide: (f) => EditorView.decorations.from(f),
  })
}

function splitRow(text: string): string[] {
  const inner = text.trim().replace(/^\|/, '').replace(/\|$/, '')
  const cells: string[] = []
  let buf = ''
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]
    if (ch === '\\' && inner[i + 1] === '|') {
      buf += '|'
      i++
    } else if (ch === '|') {
      cells.push(buf.trim())
      buf = ''
    } else buf += ch
  }
  cells.push(buf.trim())
  return cells
}

class BlockMathWidget extends WidgetType {
  constructor(private expr: string) { super() }
  eq(other: BlockMathWidget) { return other.expr === this.expr }
  toDOM() {
    const wrap = document.createElement('div')
    wrap.className = 'cm-md-math-block'
    try {
      wrap.innerHTML = katex.renderToString(this.expr, { displayMode: true, throwOnError: false, output: 'html' })
    } catch {
      wrap.textContent = this.expr
    }
    return wrap
  }
  ignoreEvent() { return true }
}

class TocWidget extends WidgetType {
  constructor(
    private headings: { level: number; text: string; line: number }[],
    private onJump?: (line: number) => void,
  ) {
    super()
  }
  eq(other: TocWidget) {
    return JSON.stringify(other.headings) === JSON.stringify(this.headings)
  }
  toDOM() {
    const wrap = document.createElement('div')
    wrap.className = 'cm-md-toc'
    const title = document.createElement('div')
    title.className = 'cm-md-toc-title'
    title.textContent = '目录'
    wrap.appendChild(title)
    if (!this.headings.length) {
      const empty = document.createElement('span')
      empty.textContent = '还没有标题，写下第一个 ## 小节吧。'
      wrap.appendChild(empty)
      return wrap
    }
    const list = document.createElement('div')
    list.className = 'cm-md-toc-list'
    this.headings.forEach((h) => {
      const item = document.createElement('button')
      item.type = 'button'
      item.className = `cm-md-toc-item level-${h.level}`
      item.dataset.line = String(h.line)
      item.textContent = h.text
      item.addEventListener('click', (e) => {
        e.preventDefault()
        this.onJump?.(h.line)
      })
      list.appendChild(item)
    })
    wrap.appendChild(list)
    ;(wrap as any).__inkspireToc = (line: number) => this.onJump?.(line)
    return wrap
  }
  ignoreEvent() {
    return false
  }
}

class FigureWidget extends WidgetType {
  constructor(private code: string) {
    super()
  }
  eq(other: FigureWidget) {
    return other.code === this.code
  }
  toDOM() {
    const wrap = document.createElement('div')
    wrap.className = 'cm-md-figure'
    const spec = parseFigureBlock(this.code)
    if (!spec) {
      wrap.innerHTML = '<div class="cm-md-figure-error">图解 JSON 解析失败，切到源码模式检查字段。</div>'
      return wrap
    }
    const head = document.createElement('div')
    head.className = 'cm-md-figure-head'
    head.innerHTML = `<span>${FIGURE_LABEL[spec.kind]}</span><em>AI 图解 · 源码可改</em>`
    const body = document.createElement('div')
    body.className = 'cm-md-figure-body'
    body.innerHTML = renderFigureSvg(spec)
    wrap.appendChild(head)
    wrap.appendChild(body)
    return wrap
  }
  ignoreEvent() {
    return true
  }
}

class MermaidWidget extends WidgetType {
  constructor(
    private code: string,
    private from: number,
    private to: number,
    private id: string,
    private onEdit?: (payload: MermaidEditPayload) => void,
  ) {
    super()
  }
  eq(other: MermaidWidget) {
    return other.code === this.code && other.from === this.from && other.to === this.to
  }
  toDOM() {
    const outer = document.createElement('div')
    outer.className = 'cm-md-block-wrap'
    const wrap = document.createElement('div')
    wrap.className = 'cm-md-mermaid'
    wrap.title = '点击直接编辑'
    const head = document.createElement('div')
    head.className = 'cm-md-mermaid-head'
    head.innerHTML = '<span>Mermaid 图解</span><em>点击编辑</em>'
    wrap.appendChild(head)
    const body = document.createElement('div')
    body.className = 'cm-md-mermaid-body'
    body.textContent = '正在绘制…'
    wrap.appendChild(body)
    const dark = document.documentElement.dataset.theme === 'night'
    void import('mermaid')
      .then(async (mod) => {
        const mermaid = mod.default
        mermaid.initialize({ startOnLoad: false, theme: dark ? 'dark' : 'base', securityLevel: 'strict', fontFamily: 'inherit' })
        const { svg } = await mermaid.render(`ink-mermaid-${Date.now()}-${this.id}`, this.code)
        body.innerHTML = svg
      })
      .catch(() => {
        body.textContent = 'Mermaid 语法有误，切到源码模式检查一下。'
      })
    const edit = (e: Event) => {
      e.preventDefault()
      e.stopPropagation()
      this.onEdit?.({ from: this.from, to: this.to, code: this.code })
    }
    ;(wrap as any).__inkspireEdit = () => this.onEdit?.({ from: this.from, to: this.to, code: this.code })
    wrap.addEventListener('mousedown', edit)
    outer.appendChild(wrap)
    return outer
  }
  ignoreEvent() {
    return false
  }
}

class TableWidget extends WidgetType {
  constructor(
    private rows: string[][],
    private aligns: string[],
    private from: number,
    private to: number,
    private onEdit?: (payload: TableEditPayload) => void,
  ) {
    super()
  }
  eq(other: TableWidget) {
    return other.from === this.from && other.to === this.to && JSON.stringify(other.rows) === JSON.stringify(this.rows)
  }
  toDOM() {
    const outer = document.createElement('div')
    outer.className = 'cm-md-block-wrap'
    const wrap = document.createElement('div')
    wrap.className = 'cm-md-table-widget'
    wrap.title = '点击直接编辑'
    const table = document.createElement('table')
    const header = this.rows[0] ?? []
    const thead = document.createElement('thead')
    const htr = document.createElement('tr')
    header.forEach((cell, i) => {
      const th = document.createElement('th')
      th.textContent = cell.replace(/[*_`]/g, '')
      if (this.aligns[i]) th.style.textAlign = this.aligns[i]
      htr.appendChild(th)
    })
    thead.appendChild(htr)
    table.appendChild(thead)
    const tbody = document.createElement('tbody')
    this.rows.slice(1).forEach((row) => {
      const tr = document.createElement('tr')
      row.forEach((cell, i) => {
        const td = document.createElement('td')
        td.textContent = cell.replace(/[*_`]/g, '')
        if (this.aligns[i]) td.style.textAlign = this.aligns[i]
        tr.appendChild(td)
      })
      tbody.appendChild(tr)
    })
    table.appendChild(tbody)
    wrap.appendChild(table)
    const hint = document.createElement('span')
    hint.className = 'cm-md-table-hint'
    hint.textContent = `${this.rows.length - 1} 行 × ${header.length} 列 · 点击直接编辑`
    wrap.appendChild(hint)
    const edit = (e: Event) => {
      e.preventDefault()
      e.stopPropagation()
      this.onEdit?.({ from: this.from, to: this.to, rows: this.rows, aligns: this.aligns })
    }
    ;(wrap as any).__inkspireEdit = () => this.onEdit?.({ from: this.from, to: this.to, rows: this.rows, aligns: this.aligns })
    wrap.addEventListener('mousedown', edit)
    wrap.addEventListener('click', edit)
    outer.appendChild(wrap)
    return outer
  }
  ignoreEvent() {
    return false
  }
}

const EMOJI: Record<string, string> = {
  smile: '😄', grin: '😁', joy: '😂', wink: '😉', heart: '❤️', thumbsup: '👍', tada: '🎉',
  fire: '🔥', sparkles: '✨', rocket: '🚀', eyes: '👀', clap: '👏', wave: '👋', thinking: '🤔',
  sweat_smile: '😅', sob: '😭', angry: '😠', cool: '😎', star: '⭐', check: '✅', x: '❌',
  warning: '⚠️', bulb: '💡', memo: '📝', book: '📖', coffee: '☕', sun: '☀️', moon: '🌙',
  cat: '🐱', dog: '🐶', ink: '🖋️', momo: '🐙',
}

class EmojiWidget extends WidgetType {
  constructor(private ch: string) { super() }
  eq(other: EmojiWidget) { return other.ch === this.ch }
  toDOM() {
    const span = document.createElement('span')
    span.className = 'cm-md-emoji'
    span.textContent = this.ch
    return span
  }
  ignoreEvent() { return true }
}

class MathWidget extends WidgetType {
  constructor(private expr: string) {
    super()
  }
  eq(other: MathWidget) {
    return other.expr === this.expr
  }
  toDOM() {
    const span = document.createElement('span')
    span.className = 'cm-md-math'
    try {
      span.innerHTML = katex.renderToString(this.expr, { throwOnError: false, displayMode: false })
    } catch {
      span.textContent = `$${this.expr}$`
    }
    return span
  }
  ignoreEvent() {
    return false
  }
}

class ImageWidget extends WidgetType {
  constructor(private src: string, private alt: string) {
    super()
  }
  eq(other: ImageWidget) {
    return other.src === this.src
  }
  toDOM() {
    const wrap = document.createElement('span')
    wrap.className = 'cm-md-image'
    const img = document.createElement('img')
    img.alt = this.alt
    img.loading = 'lazy'
    img.dataset.preview = this.src
    if (this.src.startsWith('assets/')) {
      void assetUrl(this.src).then((url) => {
        if (url) {
          img.src = url
          img.dataset.preview = url
        }
      })
    } else {
      img.src = this.src
    }
    img.tabIndex = 0
    img.setAttribute('role', 'button')
    img.setAttribute('aria-label', this.alt ? `放大图片：${this.alt}` : '放大图片')
    const open = () => window.dispatchEvent(new CustomEvent('inkspire:image-preview', { detail: img.dataset.preview || this.src }))
    img.addEventListener('click', open)
    img.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        open()
      }
    })
    wrap.appendChild(img)
    if (this.alt) {
      const cap = document.createElement('span')
      cap.className = 'cm-md-image-alt'
      cap.textContent = this.alt
      wrap.appendChild(cap)
    }
    return wrap
  }
  ignoreEvent() {
    return false
  }
}

class HrWidget extends WidgetType {
  toDOM() {
    const el = document.createElement('span')
    el.className = 'cm-md-hr-widget'
    el.textContent = '· · ·'
    return el
  }
  ignoreEvent() {
    return true
  }
}
