export type FigureKind = 'flow' | 'compare' | 'concept-map' | 'timeline' | 'quantity' | 'architecture'

export interface FigureNode {
  id?: string
  label: string
  detail?: string
}

export interface CompareSide {
  title: string
  items: string[]
}

export interface FigureBar {
  label: string
  value: number
  note?: string
}

export interface FigureEvent {
  time: string
  label: string
  detail?: string
}

export interface FigureLayer {
  title: string
  items: string[]
}

export interface FigureSpec {
  version: 1
  kind: FigureKind
  title: string
  focus?: string
  nodes: FigureNode[]
  edges?: { from: string; to: string; label?: string }[]
  left?: CompareSide
  right?: CompareSide
  bars?: FigureBar[]
  events?: FigureEvent[]
  layers?: FigureLayer[]
  annotations?: string[]
  takeaway?: string
}

const KINDS: FigureKind[] = ['flow', 'compare', 'concept-map', 'timeline', 'quantity', 'architecture']

const MAX_NODES = 6

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map((x) => text(x)).filter(Boolean) : []
}

/** 模型输出经常多/少字段；这里做确定性收口，绝不把畸形 spec 带进渲染器 */
export function normalizeFigureSpec(input: unknown): FigureSpec {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, any>
  const kind: FigureKind = KINDS.includes(raw.kind) ? raw.kind : 'flow'
  const title = text(raw.title, kind === 'compare' ? '对比' : kind === 'timeline' ? '时间线' : kind === 'quantity' ? '数量对比' : kind === 'architecture' ? '架构分层' : kind === 'concept-map' ? '概念关系' : '流程')
  const nodes: FigureNode[] = Array.isArray(raw.nodes)
    ? raw.nodes
        .map((n: any) => ({ id: text(n?.id) || undefined, label: text(n?.label ?? n?.title), detail: text(n?.detail) || undefined }))
        .filter((n: FigureNode) => n.label)
        .slice(0, 8)
    : []
  const left: CompareSide | undefined = raw.left
    ? { title: text(raw.left.title, '方案 A'), items: strings(raw.left.items).slice(0, 5) }
    : undefined
  const right: CompareSide | undefined = raw.right
    ? { title: text(raw.right.title, '方案 B'), items: strings(raw.right.items).slice(0, 5) }
    : undefined
  const edges = Array.isArray(raw.edges)
    ? raw.edges
        .map((e: any) => ({ from: text(e?.from), to: text(e?.to), label: text(e?.label) || undefined }))
        .filter((e: { from: string; to: string }) => e.from && e.to)
        .slice(0, 16)
    : undefined
  const bars: FigureBar[] | undefined = Array.isArray(raw.bars)
    ? raw.bars
        .map((b: any) => ({ label: text(b?.label), value: Number(b?.value) || 0, note: text(b?.note) || undefined }))
        .filter((b: FigureBar) => b.label)
        .slice(0, 6)
    : undefined
  const events: FigureEvent[] | undefined = Array.isArray(raw.events)
    ? raw.events
        .map((e: any) => ({ time: text(e?.time), label: text(e?.label ?? e?.title), detail: text(e?.detail) || undefined }))
        .filter((e: FigureEvent) => e.label)
        .slice(0, 6)
    : undefined
  const layers: FigureLayer[] | undefined = Array.isArray(raw.layers)
    ? raw.layers
        .map((l: any) => ({ title: text(l?.title) || '层', items: strings(l?.items).slice(0, 5) }))
        .slice(0, 5)
    : undefined

  if (kind === 'compare' && (!left || !right)) {
    const half = Math.max(1, Math.ceil(nodes.length / 2))
    const toSide = (list: FigureNode[], name: string): CompareSide => ({
      title: name,
      items: list.map((n) => n.label).slice(0, 5),
    })
    return {
      version: 1,
      kind: 'compare',
      title,
      focus: text(raw.focus) || undefined,
      nodes,
      left: left ?? toSide(nodes.slice(0, half), '现状'),
      right: right ?? toSide(nodes.slice(half), '方案'),
      annotations: strings(raw.annotations).slice(0, 3),
      takeaway: text(raw.takeaway) || undefined,
    }
  }

  const normalized: FigureSpec = {
    version: 1,
    kind,
    title,
    focus: text(raw.focus) || undefined,
    nodes,
    edges,
    left,
    right,
    bars,
    events,
    layers,
    annotations: strings(raw.annotations).slice(0, 3),
    takeaway: text(raw.takeaway) || undefined,
  }

  // 图型字段缺省时用 nodes 做最低限度兜底，绝不交给渲染器空数据
  if (kind === 'timeline' && (!normalized.events || !normalized.events.length)) {
    normalized.events = nodes.slice(0, 6).map((n, i) => ({ time: `阶段 ${i + 1}`, label: n.label, detail: n.detail }))
  }
  if (kind === 'quantity' && (!normalized.bars || !normalized.bars.length)) {
    normalized.bars = nodes.slice(0, 6).map((n) => ({ label: n.label, value: 1 }))
  }
  if (kind === 'architecture' && (!normalized.layers || !normalized.layers.length)) {
    normalized.layers = nodes.slice(0, 5).map((n) => ({ title: n.label, items: n.detail ? [n.detail] : [] }))
  }
  if ((kind === 'flow' || kind === 'concept-map') && !normalized.nodes.length) {
    normalized.nodes = [{ label: '开始' }, { label: '下一步' }]
  }
  if (kind === 'concept-map' && !normalized.edges?.length && normalized.nodes.length > 1) {
    normalized.edges = normalized.nodes.slice(1).map((n, i) => ({ from: normalized.nodes[0].id ?? '0', to: n.id ?? String(i + 1) }))
  }
  return normalized
}

/** 从模型回复里抓第一个完整 JSON 对象，容忍 ```json 围栏和前后解释 */
export function parseFigureResponse(raw: string): FigureSpec {
  const cleaned = raw.replace(/```(?:json)?/gi, '').trim()
  const start = cleaned.indexOf('{')
  if (start < 0) throw new Error('模型没有返回 JSON 图规格')
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        const parsed = JSON.parse(cleaned.slice(start, i + 1))
        return normalizeFigureSpec(parsed)
      }
    }
  }
  throw new Error('模型返回的 JSON 不完整')
}

export function figureMarkdown(spec: FigureSpec): string {
  const fence = '```'
  return `\n\n${fence}figure\n${JSON.stringify(spec, null, 2)}\n${fence}\n\n`
}

export function parseFigureBlock(code: string): FigureSpec | null {
  try {
    return normalizeFigureSpec(JSON.parse(code))
  } catch {
    return null
  }
}

/** 整篇视觉提纲：模型输出 [{section, spec}] 或 {figures:[...]} */
export function parseFigurePlan(raw: string): { section: string; spec: FigureSpec }[] {
  const cleaned = raw.replace(/```(?:json)?/gi, '').trim()
  const start = cleaned.indexOf('[')
  const objStart = cleaned.indexOf('{')
  if (start < 0 && objStart < 0) throw new Error('模型没有返回图解提纲')
  let jsonText = cleaned
  if (start >= 0 && (objStart < 0 || start < objStart)) {
    let depth = 0
    let inString = false
    let escaped = false
    for (let i = start; i < cleaned.length; i++) {
      const ch = cleaned[i]
      if (inString) {
        if (escaped) escaped = false
        else if (ch === '\\') escaped = true
        else if (ch === '"') inString = false
        continue
      }
      if (ch === '"') inString = true
      else if (ch === '[') depth++
      else if (ch === ']') {
        depth--
        if (depth === 0) {
          jsonText = cleaned.slice(start, i + 1)
          break
        }
      }
    }
  }
  const parsed = JSON.parse(jsonText)
  const rows = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.figures) ? parsed.figures : []
  return rows
    .map((row: any) => ({ section: text(row?.section ?? row?.heading ?? row?.title), spec: normalizeFigureSpec(row?.spec ?? row) }))
    .filter((row: { section: string; spec: FigureSpec }) => row.section && row.spec.title)
    .slice(0, 10)
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function wrap(text: string, max: number, maxLines = 3): string[] {
  const chars = Array.from(text.replace(/\s+/g, ' ').trim())
  const lines: string[] = []
  let line = ''
  for (const ch of chars) {
    line += ch
    const visual = Array.from(line).reduce((n, c) => n + (/[\u4e00-\u9fa5]/.test(c) ? 2 : 1), 0)
    if (visual >= max * 2) {
      lines.push(line)
      line = ''
      if (lines.length >= maxLines) break
    }
  }
  if (line && lines.length < maxLines) lines.push(line)
  if (!lines.length) lines.push('')
  if (lines.length === maxLines && chars.join('').length > lines.join('').length) {
    lines[lines.length - 1] = `${lines[lines.length - 1].slice(0, Math.max(1, max - 1))}…`
  }
  return lines
}

function tspan(lines: string[], x: number, y: number, lineHeight: number, cls: string): string {
  return lines
    .map((line, i) => `<tspan x="${x}" y="${y + i * lineHeight}" class="${cls}">${esc(line)}</tspan>`)
    .join('')
}

function flowSvg(spec: FigureSpec): string {
  const width = 720
  const top = spec.focus ? 78 : 56
  const gap = 46
  const nodeH = 58
  const nodeW = 420
  const nodeX = (width - nodeW) / 2
  const nodes = spec.nodes.slice(0, MAX_NODES)
  const bodyH = nodes.length * nodeH + Math.max(0, nodes.length - 1) * gap
  const annH = spec.annotations?.length ? 26 + spec.annotations.length * 22 : 0
  const takeH = spec.takeaway ? 54 : 0
  const height = top + bodyH + annH + takeH + 32
  const parts: string[] = []
  parts.push(
    `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(spec.title)}">`,
    `<defs><marker id="fig-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="var(--ink-soft)"/></marker></defs>`,
    `<text x="34" y="34" class="fig-title">${esc(spec.title)}</text>`,
  )
  if (spec.focus) parts.push(`<text x="34" y="56" class="fig-focus">${esc(spec.focus)}</text>`)

  nodes.forEach((node, i) => {
    const y = top + i * (nodeH + gap)
    parts.push(
      `<g class="fig-node">`,
      `<rect x="${nodeX}" y="${y}" width="${nodeW}" height="${nodeH}" rx="12"/>`,
      `<circle cx="${nodeX + 24}" cy="${y + nodeH / 2}" r="13" class="fig-num"/>`,
      `<text x="${nodeX + 24}" y="${y + nodeH / 2 + 4}" class="fig-num-text">${i + 1}</text>`,
      `<text x="${nodeX + 50}" y="${y + 24}" class="fig-node-label">${tspan(wrap(node.label, 22, node.detail ? 1 : 2), nodeX + 50, y + 24, 20, 'fig-node-label')}</text>`,
    )
    if (node.detail) {
      parts.push(`<text x="${nodeX + 50}" y="${y + 44}" class="fig-node-detail">${tspan(wrap(node.detail, 26, 1), nodeX + 50, y + 44, 16, 'fig-node-detail')}</text>`)
    }
    parts.push(`</g>`)
    if (i < nodes.length - 1) {
      const y1 = y + nodeH + 4
      const y2 = y + nodeH + gap - 8
      parts.push(`<line x1="${width / 2}" y1="${y1}" x2="${width / 2}" y2="${y2}" class="fig-edge" marker-end="url(#fig-arrow)"/>`)
    }
  })

  let cursor = top + bodyH + 19
  if (spec.annotations?.length) {
    parts.push(`<text x="34" y="${cursor}" class="fig-ann-title">注解</text>`)
    cursor += 18
    spec.annotations.forEach((a, i) => {
      parts.push(`<circle cx="40" cy="${cursor - 4}" r="7" class="fig-ann-dot"/><text x="40" y="${cursor}" class="fig-ann-num">${i + 1}</text>`)
      parts.push(`<text x="54" y="${cursor}" class="fig-ann-text">${esc(a)}</text>`)
      cursor += 22
    })
  }
  if (spec.takeaway) {
    const y = height - 58
    parts.push(
      `<rect x="34" y="${y}" width="${width - 68}" height="38" rx="10" class="fig-takeaway"/>`,
      `<text x="50" y="${y + 24}" class="fig-takeaway-label">记住</text>`,
      `<text x="92" y="${y + 24}" class="fig-takeaway-text">${esc(spec.takeaway)}</text>`,
    )
  }
  parts.push('</svg>')
  return parts.join('')
}

function compareSvg(spec: FigureSpec): string {
  const width = 720
  const top = spec.focus ? 78 : 56
  const left = spec.left ?? { title: '现状', items: [''] }
  const right = spec.right ?? { title: '方案', items: [''] }
  const maxItems = Math.max(left.items.length, right.items.length, 1)
  const panelH = 50 + maxItems * 28
  const takeH = spec.takeaway ? 54 : 0
  const height = top + panelH + takeH + 30
  const panelW = 310
  const parts = [
    `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(spec.title)}">`,
    `<text x="34" y="34" class="fig-title">${esc(spec.title)}</text>`,
  ]
  if (spec.focus) parts.push(`<text x="34" y="56" class="fig-focus">${esc(spec.focus)}</text>`)
  const sides = [
    { x: 34, side: left, cls: 'left' },
    { x: 34 + panelW + 32, side: right, cls: 'right' },
  ]
  sides.forEach(({ x, side, cls }) => {
    parts.push(
      `<g class="fig-compare-panel ${cls}">`,
      `<rect x="${x}" y="${top}" width="${panelW}" height="${panelH}" rx="14"/>`,
      `<rect x="${x}" y="${top}" width="${panelW}" height="42" rx="14" class="fig-compare-head"/>`,
      `<text x="${x + 16}" y="${top + 27}" class="fig-compare-title">${esc(side.title)}</text>`,
    )
    side.items.slice(0, 5).forEach((item, i) => {
      const y = top + 66 + i * 28
      parts.push(`<circle cx="${x + 20}" cy="${y - 4}" r="4" class="fig-bullet"/>`)
      parts.push(`<text x="${x + 34}" y="${y}" class="fig-compare-item">${tspan(wrap(item, 24, 1), x + 34, y, 16, 'fig-compare-item')}</text>`)
    })
    parts.push(`</g>`)
  })
  if (spec.takeaway) {
    const y = height - 58
    parts.push(
      `<rect x="34" y="${y}" width="${width - 68}" height="38" rx="10" class="fig-takeaway"/>`,
      `<text x="50" y="${y + 24}" class="fig-takeaway-label">记住</text>`,
      `<text x="92" y="${y + 24}" class="fig-takeaway-text">${esc(spec.takeaway)}</text>`,
    )
  }
  parts.push('</svg>')
  return parts.join('')
}

export const FIGURE_PROMPT = `你是 Inkspire 的图解编排器。把用户选中的内容变成一张结构图，只输出一个 JSON 对象，不要解释、不要 Markdown 围栏。

图型只能是：
- "flow"：有先后、步骤、链路。nodes 2-6 个，按顺序排列。
- "compare"：有明确两边对比。left/right 各 2-5 条。
- "concept-map"：概念之间的关系。nodes 3-8 个，可用 edges 指定关系。
- "timeline"：时间/阶段。events 2-6 个，每个含 time + label。
- "quantity"：数量或占比。bars 2-6 个，每个含 label + value（数字）。
- "architecture"：分层结构。layers 2-5 个，每个含 title + items。

通用字段：
{"kind":"flow|compare|concept-map|timeline|quantity|architecture","title":"不超过 18 字","focus":"一句话重点，可省略","nodes":[{"id":"可选","label":"不超过 20 字","detail":"可选"}],"edges":[{"from":"节点id","to":"节点id","label":"可选"}],"left":{"title":"方案 A","items":["..."]},"right":{"title":"方案 B","items":["..."]},"bars":[{"label":"...","value":12}],"events":[{"time":"2024","label":"..."}],"layers":[{"title":"接入层","items":["..."]}],"annotations":["最多 3 条"],"takeaway":"一句话结论，不超过 30 字"}

硬规则：
1. 只写原文支持的内容，不要补充事实。
2. 图内不要出现长段落；每条尽量短。
3. 如果图型是 flow/compare，不要编造 steps 数量与节点数量不一致。
4. 中文标点正常使用，不要输出 HTML。
5. 输出必须是可解析的 JSON。`

export interface FigureIssue {
  level: 'error' | 'warn'
  code: string
  message: string
}

const CN_NUM: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }

/** 确定性质量闸门：只做可测的规则，不调用模型 */
export function validateFigure(spec: FigureSpec, source = ''): FigureIssue[] {
  const issues: FigureIssue[] = []
  const labels = spec.nodes.map((n) => n.label.trim())
  const add = (level: FigureIssue['level'], code: string, message: string) => issues.push({ level, code, message })

  if (!spec.title.trim()) add('error', 'TITLE_EMPTY', '缺少图标题')
  if (spec.title.length > 24) add('warn', 'TITLE_LONG', '图标题偏长，可能被截断')
  if (spec.focus && spec.focus.length > 40) add('warn', 'FOCUS_LONG', '重点说明偏长')
  if (spec.takeaway && spec.takeaway.length > 44) add('warn', 'TAKEAWAY_LONG', '结论偏长')

  if (spec.kind === 'flow') {
    if (labels.length < 2) add('error', 'NODES_TOO_FEW', '流程图至少需要 2 个节点')
    if (labels.length > MAX_NODES) add('error', 'NODES_TOO_MANY', `流程图最多 ${MAX_NODES} 个节点`)
    labels.forEach((label, i) => {
      if (!label) add('error', 'LABEL_EMPTY', `第 ${i + 1} 个节点没有文字`)
      if (label.length > 30) add('error', 'LABEL_TOO_LONG', `第 ${i + 1} 个节点文字过长，会溢出节点`)
      else if (label.length > 22) add('warn', 'LABEL_LONG', `第 ${i + 1} 个节点文字偏长`)
    })
    if (new Set(labels).size !== labels.length) add('warn', 'NODE_DUPLICATE', '有重复节点，确认是否真的需要')
    const countText = `${spec.title} ${spec.focus ?? ''}`
    const m = countText.match(/([一二两三四五六七八九十\d]+)\s*(?:个)?\s*(步骤|步|节点|阶段|部分|类|种)/)
    if (m) {
      const n = /^\d+$/.test(m[1]) ? Number(m[1]) : CN_NUM[m[1]]
      if (n && n !== labels.length) add('error', 'COUNT_MISMATCH', `文案说 ${n} 个${m[2]}，图里却有 ${labels.length} 个节点`)
    }
  }

  if (spec.kind === 'compare') {
    if (!spec.left || !spec.right) add('error', 'COMPARE_SIDE_MISSING', '对比图必须同时有左右两边')
    for (const [name, side] of [['左', spec.left], ['右', spec.right]] as const) {
      if (!side) continue
      if (!side.items.length) add('error', 'COMPARE_EMPTY', `${name}边没有内容`)
      if (side.items.length > 5) add('warn', 'COMPARE_TOO_MANY', `${name}边超过 5 条，阅读会挤`)
      side.items.forEach((item, i) => {
        if (item.length > 34) add('warn', 'COMPARE_ITEM_LONG', `${name}边第 ${i + 1} 条偏长，会被截断`)
      })
    }
    if (spec.left && spec.right && spec.left.items.join('|') === spec.right.items.join('|')) {
      add('warn', 'COMPARE_SAME', '左右两边内容相同，不像对比')
    }
  }

  if (spec.kind === 'timeline') {
    const events = spec.events ?? []
    if (events.length < 2) add('error', 'TIMELINE_TOO_FEW', '时间线至少需要 2 个事件')
    if (events.length > 6) add('error', 'TIMELINE_TOO_MANY', '时间线最多 6 个事件')
    events.forEach((e, i) => {
      if (!e.time) add('warn', 'TIME_EMPTY', `第 ${i + 1} 个事件没有时间`)
      if (e.label.length > 24) add('warn', 'TIME_LABEL_LONG', `第 ${i + 1} 个事件文字偏长`)
    })
  }

  if (spec.kind === 'quantity') {
    const bars = spec.bars ?? []
    if (bars.length < 2) add('error', 'BARS_TOO_FEW', '数量图至少需要 2 组数据')
    if (bars.length > 6) add('error', 'BARS_TOO_MANY', '数量图最多 6 组数据')
    bars.forEach((b, i) => {
      if (!b.label) add('error', 'BAR_LABEL_EMPTY', `第 ${i + 1} 组数据没有标签`)
      if (!Number.isFinite(b.value)) add('error', 'BAR_VALUE_INVALID', `第 ${i + 1} 组数据不是数字`)
    })
  }

  if (spec.kind === 'architecture') {
    const layers = spec.layers ?? []
    if (layers.length < 2) add('error', 'LAYERS_TOO_FEW', '架构图至少需要 2 层')
    if (layers.length > 5) add('error', 'LAYERS_TOO_MANY', '架构图最多 5 层')
    layers.forEach((l, i) => {
      if (!l.items.length) add('warn', 'LAYER_EMPTY', `第 ${i + 1} 层没有条目`)
    })
  }

  if (spec.kind === 'concept-map') {
    if (spec.nodes.length < 2) add('error', 'CONCEPT_TOO_FEW', '概念图至少需要 2 个概念')
    if (spec.nodes.length > 8) add('error', 'CONCEPT_TOO_MANY', '概念图最多 8 个概念')
  }

  if (spec.annotations && spec.annotations.length > 3) add('error', 'ANN_TOO_MANY', '注解最多 3 条')
  if (source.trim()) {
    const sourceText = source.toLowerCase()
    const tokens = new Set(
      (sourceText.match(/[\u4e00-\u9fa5]{2,}|[a-z0-9_]{3,}/g) ?? []).map((t) => t.toLowerCase()),
    )
    if (tokens.size) {
      let hit = 0
      for (const label of labels) {
        const low = label.toLowerCase()
        if ([...tokens].some((t) => low.includes(t) || t.includes(low))) hit++
      }
      if (hit / Math.max(1, labels.length) < 0.2) {
        add('warn', 'SOURCE_LOW_MATCH', '图里的词与原文重合较少，确认没有编造内容')
      }
    }
  }
  return issues
}


function timelineSvg(spec: FigureSpec): string {
  const width = 720
  const top = spec.focus ? 84 : 62
  const events = (spec.events ?? []).slice(0, 6)
  const height = 360 + (spec.takeaway ? 44 : 0)
  const lineY = top + 126
  const left = 110
  const right = width - 110
  const gap = (right - left) / Math.max(1, events.length - 1)
  const parts = [
    `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(spec.title)}">`,
    `<text x="34" y="34" class="fig-title">${esc(spec.title)}</text>`,
  ]
  if (spec.focus) parts.push(`<text x="34" y="58" class="fig-focus">${esc(spec.focus)}</text>`)
  parts.push(`<line x1="${left}" y1="${lineY}" x2="${right}" y2="${lineY}" class="fig-timeline-line"/>`)
  events.forEach((ev, i) => {
    const x = left + i * gap
    const above = i % 2 === 0
    const labelY = above ? lineY - 30 : lineY + 42
    parts.push(
      `<circle cx="${x}" cy="${lineY}" r="7" class="fig-timeline-dot"/>`,
      `<text x="${x}" y="${lineY + (above ? -14 : 22)}" class="fig-timeline-time">${esc(ev.time)}</text>`,
      `<text x="${x}" y="${labelY}" class="fig-timeline-label">${tspan(wrap(ev.label, 10, 2), x, labelY, 16, 'fig-timeline-label')}</text>`,
    )
    if (ev.detail) parts.push(`<text x="${x}" y="${labelY + 34}" class="fig-timeline-detail">${tspan(wrap(ev.detail, 16, 1), x, labelY + 34, 15, 'fig-timeline-detail')}</text>`)
  })
  if (spec.takeaway) {
    const y = height - 54
    parts.push(`<rect x="34" y="${y}" width="${width - 68}" height="36" rx="10" class="fig-takeaway"/><text x="50" y="${y + 23}" class="fig-takeaway-label">记住</text><text x="92" y="${y + 23}" class="fig-takeaway-text">${esc(spec.takeaway)}</text>`)
  }
  parts.push('</svg>')
  return parts.join('')
}

function quantitySvg(spec: FigureSpec): string {
  const width = 720
  const top = spec.focus ? 88 : 66
  const bars = (spec.bars ?? []).slice(0, 6)
  const height = top + bars.length * 52 + (spec.takeaway ? 50 : 20)
  const max = Math.max(...bars.map((b) => b.value), 1)
  const parts = [
    `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(spec.title)}">`,
    `<text x="34" y="34" class="fig-title">${esc(spec.title)}</text>`,
  ]
  if (spec.focus) parts.push(`<text x="34" y="58" class="fig-focus">${esc(spec.focus)}</text>`)
  const barLeft = 200
  const barMax = 380
  bars.forEach((bar, i) => {
    const y = top + i * 52
    const w = Math.max(4, (bar.value / max) * barMax)
    parts.push(
      `<text x="34" y="${y + 22}" class="fig-bar-label">${esc(bar.label.slice(0, 14))}</text>`,
      `<rect x="${barLeft}" y="${y + 8}" width="${barMax}" height="20" rx="10" class="fig-bar-track"/>`,
      `<rect x="${barLeft}" y="${y + 8}" width="${w}" height="20" rx="10" class="fig-bar-fill"/>`,
      `<text x="${barLeft + barMax + 14}" y="${y + 23}" class="fig-bar-value">${bar.value}</text>`,
    )
    if (bar.note) parts.push(`<text x="${barLeft}" y="${y + 42}" class="fig-bar-note">${esc(bar.note)}</text>`)
  })
  if (spec.takeaway) {
    const y = height - 52
    parts.push(`<rect x="34" y="${y}" width="${width - 68}" height="36" rx="10" class="fig-takeaway"/><text x="50" y="${y + 23}" class="fig-takeaway-label">记住</text><text x="92" y="${y + 23}" class="fig-takeaway-text">${esc(spec.takeaway)}</text>`)
  }
  parts.push('</svg>')
  return parts.join('')
}

function architectureSvg(spec: FigureSpec): string {
  const width = 720
  const top = spec.focus ? 88 : 66
  const layers = (spec.layers ?? []).slice(0, 5)
  const layerH = 76
  const height = top + layers.length * (layerH + 12) + (spec.takeaway ? 50 : 20)
  const parts = [
    `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(spec.title)}">`,
    `<text x="34" y="34" class="fig-title">${esc(spec.title)}</text>`,
  ]
  if (spec.focus) parts.push(`<text x="34" y="58" class="fig-focus">${esc(spec.focus)}</text>`)
  layers.forEach((layer, i) => {
    const y = top + i * (layerH + 12)
    parts.push(
      `<rect x="34" y="${y}" width="${width - 68}" height="${layerH}" rx="12" class="fig-arch-layer"/>`,
      `<rect x="34" y="${y}" width="150" height="${layerH}" rx="12" class="fig-arch-title-bg"/>`,
      `<text x="50" y="${y + 30}" class="fig-arch-title">${esc(layer.title.slice(0, 9))}</text>`,
    )
    layer.items.slice(0, 4).forEach((item, j) => {
      const x = 200 + (j % 2) * 230
      const yy = y + (j < 2 ? 22 : 50)
      parts.push(`<rect x="${x}" y="${yy - 13}" width="210" height="25" rx="8" class="fig-arch-chip"/><text x="${x + 10}" y="${yy + 4}" class="fig-arch-item">${esc(item.slice(0, 16))}</text>`)
    })
  })
  if (spec.takeaway) {
    const y = height - 52
    parts.push(`<rect x="34" y="${y}" width="${width - 68}" height="36" rx="10" class="fig-takeaway"/><text x="50" y="${y + 23}" class="fig-takeaway-label">记住</text><text x="92" y="${y + 23}" class="fig-takeaway-text">${esc(spec.takeaway)}</text>`)
  }
  parts.push('</svg>')
  return parts.join('')
}

function conceptSvg(spec: FigureSpec): string {
  const width = 720
  const height = 520
  const nodes = spec.nodes.slice(0, 8)
  const cx = width / 2
  const cy = 290
  const positions = nodes.map((n, i) => {
    if (i === 0) return { ...n, x: cx, y: cy }
    const angle = ((i - 1) / Math.max(1, nodes.length - 1)) * Math.PI * 2 - Math.PI / 2
    return { ...n, x: cx + Math.cos(angle) * 235, y: cy + Math.sin(angle) * 165 }
  })
  const byKey = new Map<string, { x: number; y: number; label: string }>()
  positions.forEach((n, i) => {
    byKey.set(String(i + 1), n)
    byKey.set(n.label, n)
    if (n.id) byKey.set(n.id, n)
  })
  const edges = spec.edges?.length
    ? spec.edges
    : positions.slice(1).map((n) => ({ from: positions[0].id ?? '1', to: n.id ?? n.label }))
  const parts = [
    `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(spec.title)}">`,
    `<text x="34" y="34" class="fig-title">${esc(spec.title)}</text>`,
  ]
  if (spec.focus) parts.push(`<text x="34" y="58" class="fig-focus">${esc(spec.focus)}</text>`)
  for (const edge of edges) {
    const a = byKey.get(edge.from) ?? byKey.get(edge.to)
    const b = byKey.get(edge.to) ?? byKey.get(edge.from)
    if (!a || !b || a === b) continue
    parts.push(`<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" class="fig-concept-edge"/>`)
  }
  positions.forEach((n, i) => {
    const r = i === 0 ? 58 : 46
    parts.push(
      `<circle cx="${n.x}" cy="${n.y}" r="${r}" class="fig-concept-node${i === 0 ? ' hub' : ''}"/>`,
      `<text x="${n.x}" y="${n.y + 4}" class="fig-concept-label">${tspan(wrap(n.label, 11, 2), n.x, n.y - 2, 15, 'fig-concept-label')}</text>`,
    )
  })
  if (spec.takeaway) {
    parts.push(`<rect x="34" y="${height - 44}" width="${width - 68}" height="30" rx="9" class="fig-takeaway"/><text x="50" y="${height - 24}" class="fig-takeaway-label">记住</text><text x="92" y="${height - 24}" class="fig-takeaway-text">${esc(spec.takeaway)}</text>`)
  }
  parts.push('</svg>')
  return parts.join('')
}

export const FIGURE_LABEL: Record<FigureKind, string> = {
  flow: '流程图',
  compare: '对比图',
  'concept-map': '概念图',
  timeline: '时间线',
  quantity: '数量图',
  architecture: '架构图',
}

export const FIGURE_PLAN_PROMPT = `你是 Inkspire 的图文编排器。为下面每个 H2 章节生成一张图规格，只输出 JSON 数组，不要解释、不要 Markdown 围栏。

输出格式：
[{"section":"章节标题原文","spec":{...}}]

每个 spec 必须符合：
- kind 只能是 flow / compare / concept-map / timeline / quantity / architecture
- title 不超过 18 字，focus 可省略
- flow: nodes 2-6 个；compare: left/right 各 2-5 条；timeline: events 2-6 个；quantity: bars 2-6 个；architecture: layers 2-5 个；concept-map: nodes 2-8 个
- annotations 最多 3 条，takeaway 不超过 30 字
- 只使用该章节原文支持的事实，不要编造
- 每个章节最多一张图；没有合适图型的章节可以跳过
- 如果章节是步骤/链路用 flow；两边取舍用 compare；时间顺序用 timeline；数字对比用 quantity；分层系统用 architecture；其余概念关系用 concept-map`


/** POC 渲染器：纯 SVG，文字由代码排版；主题色走 CSS 变量 */
export function renderFigureSvg(spec: FigureSpec): string {
  switch (spec.kind) {
    case 'compare':
      return compareSvg(spec)
    case 'timeline':
      return timelineSvg(spec)
    case 'quantity':
      return quantitySvg(spec)
    case 'architecture':
      return architectureSvg(spec)
    case 'concept-map':
      return conceptSvg(spec)
    default:
      return flowSvg(spec)
  }
}

const FIGURE_SVG_CSS = `
text{font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB",sans-serif}
.fig-title{font-size:17px;font-weight:900;fill:#2E2A3E}
.fig-focus{font-size:11px;fill:#6C6680}
.fig-node rect{fill:#fff;stroke:#2E2A3E;stroke-width:2}
.fig-num{fill:#FFC24A;stroke:#2E2A3E;stroke-width:1.5}
.fig-num-text{font-size:11px;font-weight:900;fill:#2E2A3E;text-anchor:middle}
.fig-node-label{font-size:13px;font-weight:800;fill:#2E2A3E}
.fig-node-detail{font-size:10.5px;fill:#6C6680}
.fig-edge{stroke:#6C6680;stroke-width:2}
.fig-ann-title{font-size:10px;font-weight:800;fill:#9A94AC}
.fig-ann-dot{fill:#EEEAFE;stroke:#5A52C9;stroke-width:1.5}
.fig-ann-num{font-size:8px;font-weight:900;fill:#5A52C9;text-anchor:middle}
.fig-ann-text{font-size:10.5px;fill:#6C6680}
.fig-takeaway{fill:#EEEAFE;stroke:#5A52C9;stroke-width:1.5}
.fig-takeaway-label{font-size:10px;font-weight:900;fill:#5A52C9}
.fig-takeaway-text{font-size:11px;font-weight:700;fill:#2E2A3E}
.fig-compare-panel>rect:first-child{fill:#fff;stroke:#E7DFCE;stroke-width:2}
.fig-compare-head{fill:#EEEAFE}
.fig-compare-title{font-size:12px;font-weight:900;fill:#5A52C9}
.fig-bullet{fill:#FF7A66}
.fig-compare-item{font-size:11px;fill:#2E2A3E}
.fig-timeline-line{stroke:#E7DFCE;stroke-width:3}
.fig-timeline-dot{fill:#FFC24A;stroke:#2E2A3E;stroke-width:2}
.fig-timeline-time{font-size:10px;font-weight:900;fill:#5A52C9;text-anchor:middle}
.fig-timeline-label{font-size:11px;font-weight:800;fill:#2E2A3E;text-anchor:middle}
.fig-timeline-detail{font-size:9.5px;fill:#9A94AC;text-anchor:middle}
.fig-bar-label{font-size:11px;font-weight:800;fill:#2E2A3E}
.fig-bar-track{fill:#F6EFE0;stroke:#E7DFCE}
.fig-bar-fill{fill:#5A52C9}
.fig-bar-value{font-size:12px;font-weight:900;fill:#2E2A3E}
.fig-bar-note{font-size:9.5px;fill:#9A94AC}
.fig-arch-layer{fill:#fff;stroke:#E7DFCE;stroke-width:2}
.fig-arch-title-bg{fill:#EEEAFE}
.fig-arch-title{font-size:12px;font-weight:900;fill:#5A52C9}
.fig-arch-chip{fill:#FCF8F0;stroke:#E7DFCE;stroke-width:1.2}
.fig-arch-item{font-size:10px;fill:#6C6680}
.fig-concept-edge{stroke:#E7DFCE;stroke-width:1.8}
.fig-concept-node{fill:#fff;stroke:#5A52C9;stroke-width:2.2}
.fig-concept-node.hub{fill:#5A52C9;stroke:#2E2A3E;stroke-width:2.5}
.fig-concept-label{font-size:11px;font-weight:800;fill:#2E2A3E;text-anchor:middle}
.fig-concept-node.hub+.fig-concept-label{fill:#fff}
`

/** 导出用 SVG：把 CSS 类内嵌，脱离应用样式也能被 canvas/图片查看器正确栅格化 */
export function figureExportSvg(spec: FigureSpec): { svg: string; width: number; height: number } {
  const raw = renderFigureSvg(spec)
  const match = raw.match(/viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/)
  const width = match ? Number(match[1]) : 720
  const height = match ? Number(match[2]) : 480
  const svg = raw
    .replace(/var\(--ink-soft\)/g, '#6C6680')
    .replace('<svg ', `<svg width="${width}" height="${height}" `)
    .replace('>', `><style>${FIGURE_SVG_CSS}</style>`)
  return { svg, width, height }
}

export async function svgToPngBlob(svgString: string, scale = 2): Promise<Blob> {
  const dims = svgString.match(/width="(\d+(?:\.\d+)?)" height="(\d+(?:\.\d+)?)"/)
  const width = dims ? Number(dims[1]) : 720
  const height = dims ? Number(dims[2]) : 480
  const url = URL.createObjectURL(new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' }))
  try {
    const img = new Image()
    img.decoding = 'async'
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('SVG 栅格化失败'))
      img.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(width * scale)
    canvas.height = Math.round(height * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('无法创建画布')
    ctx.scale(scale, scale)
    ctx.fillStyle = '#FFFFFF'
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(img, 0, 0, width, height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) throw new Error('PNG 编码失败')
    return blob
  } finally {
    URL.revokeObjectURL(url)
  }
}
