import type { ChapterDraft, Diagnostic } from '../../types'

export const MIN_CHAPTER = 360
export const MAX_CHAPTERS = 60
const LONG_CHAPTER = 12000

interface HeadingLine {
  level: number
  text: string
  line: number
}

export function normalizeMarkdown(md: string): string {
  return md
    .replace(/\r\n?/g, '\n')
    .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^(#{1,6})(?=[^\s#])/gm, '$1 ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

export function findHeadings(md: string): HeadingLine[] {
  const lines = md.split('\n')
  const out: HeadingLine[] = []
  let inFence = false
  lines.forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence
    if (inFence) return
    const m = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/)
    if (m) out.push({ level: m[1].length, text: m[2].replace(/[*_`]/g, '').trim(), line: i })
  })
  return out
}

/** 从整篇 Markdown 中切出章节：按频次选层级，短章合并、长章拆分、总量设上限 */
export function splitChapters(md: string): ChapterDraft[] {
  const text = normalizeMarkdown(md)
  const lines = text.split('\n')
  const headings = findHeadings(text)
  if (!headings.length) {
    return [{ title: firstTitle(text) ?? '正文', level: 1, markdown: ensureH1(text, firstTitle(text) ?? '正文') }]
  }

  const counts = new Map<number, number>()
  for (const h of headings) counts.set(h.level, (counts.get(h.level) ?? 0) + 1)

  // 出现 ≥2 次的最浅层级作为切章层级；若只有 1 个 H1 + 多个 H2，则用 H2（书名页模式）
  let level = 0
  for (const l of [1, 2, 3]) {
    if ((counts.get(l) ?? 0) >= 2) {
      level = l
      break
    }
  }
  if (!level && (counts.get(1) ?? 0) === 1 && (counts.get(2) ?? 0) >= 2) level = 2
  if (!level) {
    return [{ title: headings[0].text || '正文', level: 1, markdown: ensureH1(text, headings[0].text) }]
  }

  const marks = headings.filter((h) => h.level === level)
  if (!marks.length) return [{ title: firstTitle(text) ?? '正文', level: 1, markdown: ensureH1(text, firstTitle(text) ?? '正文') }]

  const sections: { title: string; body: string }[] = []
  const preamble = lines.slice(0, marks[0].line).join('\n').trim()
  if (preamble && plainLength(preamble) > MIN_CHAPTER) sections.push({ title: firstTitle(preamble) ?? '前言', body: preamble })

  for (let i = 0; i < marks.length; i++) {
    const start = marks[i].line
    const end = i + 1 < marks.length ? marks[i + 1].line : lines.length
    const body = lines.slice(start, end).join('\n').trim()
    sections.push({ title: marks[i].text || `第 ${i + 1} 节`, body })
  }

  // 去掉「只有标题、没有正文」的空章节（如书名页），避免把下一章吞进来
  const nonEmpty = sections.filter((sec) => {
    const bodyOnly = sec.body.split('\n').slice(1).join('\n').trim()
    return plainLength(bodyOnly) > 0
  })
  if (!nonEmpty.length) return [{ title: firstTitle(text) ?? '正文', level: 1, markdown: ensureH1(text, firstTitle(text) ?? '正文') }]

  // 短章合并：只合并相邻的两个短章，绝不把长章吞进短序言
  const merged: typeof sections = []
  for (const s of nonEmpty) {
    const prev = merged[merged.length - 1]
    const prevLen = prev ? plainLength(prev.body) : 0
    const curLen = plainLength(s.body)
    if (prev && prevLen < MIN_CHAPTER && curLen < MIN_CHAPTER * 2) {
      prev.body = `${prev.body}\n\n${s.body}`
    } else {
      merged.push({ ...s })
    }
  }

  // 长章拆分
  const finalSections: typeof sections = []
  for (const s of merged) {
    if (plainLength(s.body) > LONG_CHAPTER) {
      const parts = splitLong(s.body)
      parts.forEach((p, idx) => finalSections.push({ title: idx === 0 ? s.title : `${s.title}（续 ${idx + 1}）`, body: p }))
    } else finalSections.push(s)
  }

  // 总量上限：不断合并最短的相邻对
  while (finalSections.length > MAX_CHAPTERS) {
    let best = 0
    let bestLen = Infinity
    for (let i = 0; i < finalSections.length - 1; i++) {
      const len = plainLength(finalSections[i].body) + plainLength(finalSections[i + 1].body)
      if (len < bestLen) {
        bestLen = len
        best = i
      }
    }
    const a = finalSections[best]
    const b = finalSections[best + 1]
    finalSections.splice(best, 2, { title: a.title, body: `${a.body}\n\n${b.body}` })
  }

  return finalSections.map((s) => ({
    title: s.title,
    level,
    markdown: ensureH1(s.body, s.title),
  }))
}

function plainLength(s: string): number {
  return s.replace(/```[\s\S]*?```/g, ' ').replace(/[#>*_`~\-|\s]/g, '').length
}

function firstTitle(md: string): string | null {
  const m = md.match(/^#\s+(.+)$/m)
  return m ? m[1].replace(/[*_`]/g, '').trim() : null
}

function ensureH1(body: string, title: string): string {
  const trimmed = body.trim()
  if (/^#\s+/.test(trimmed)) return trimmed
  return `# ${title}\n\n${trimmed}`
}

function splitLong(body: string): string[] {
  const lines = body.split('\n')
  const parts: string[] = []
  let current: string[] = []
  let length = 0
  for (const line of lines) {
    current.push(line)
    length += line.length
    const isH3 = /^###\s+/.test(line)
    if ((length > 6000 && isH3) || length > 9000) {
      parts.push(current.join('\n'))
      current = []
      length = 0
    }
  }
  if (current.join('\n').trim()) parts.push(current.join('\n'))
  return parts.filter((p) => p.trim())
}

/* ------------------------------- 确定性质量检查 ------------------------------- */

/** 单章节导入时，标题应使用文档标题，而不是第一个小节标题 */
export function finalizeChapters(chapters: ChapterDraft[], title?: string): ChapterDraft[] {
  if (chapters.length !== 1 || !title) return chapters
  const ch = chapters[0]
  const body = ch.markdown.replace(/^#\s+[^\n]*\n+/, '').trim()
  return [{ title, level: 1, markdown: '# ' + title + '\n\n' + body }]
}

export function buildDiagnostics(md: string, chapters: ChapterDraft[], extra: Diagnostic[] = []): Diagnostic[] {
  const out: Diagnostic[] = [...extra]
  const lines = md.split('\n')
  const fences = lines.filter((l) => /^\s*```/.test(l)).length
  if (fences % 2 !== 0) out.push({ code: 'BROKEN_TABLE', severity: 'medium', message: '代码围栏数量为奇数，可能有未闭合的代码块' })

  const headings = findHeadings(md)
  for (let i = 1; i < headings.length; i++) {
    if (headings[i].level - headings[i - 1].level > 1) {
      out.push({ code: 'HEADING_JUMP', severity: 'low', message: `标题层级跳跃：H${headings[i - 1].level} → H${headings[i].level}（第 ${headings[i].line + 1} 行）` })
      break
    }
  }

  const pageNo = lines.filter((l) => /^\s*[-—–]?\s*\d{1,4}\s*[-—–]?\s*$/.test(l)).length
  if (pageNo / Math.max(1, lines.length) > 0.04 && pageNo > 4) {
    out.push({ code: 'RESIDUAL_PAGE_NO', severity: 'low', message: `检测到 ${pageNo} 行疑似页码残留` })
  }

  const tables = (md.match(/^\|.*\|\s*$/gm) ?? []).length
  if (tables > 6) {
    const separator = (md.match(/^\|[\s:-]+\|\s*$/gm) ?? []).length
    if (separator === 0) out.push({ code: 'TABLE_SUSPECT_FLAT', severity: 'medium', message: '疑似表格但缺少表头分隔行，已按普通文本保留' })
  }

  if (chapters.length >= MAX_CHAPTERS) {
    out.push({ code: 'TOO_MANY_CHAPTERS', severity: 'low', message: `章节目录已达 ${chapters.length} 篇上限，已自动合并短章` })
  }

  if (plainLength(md) < 120) out.push({ code: 'CONTENT_TOO_SHORT', severity: 'high', message: '解析出的正文过短，可能是扫描件或解析失败' })
  return out
}

export function scoreQuality(md: string, chapters: ChapterDraft[], diagnostics: Diagnostic[], pageCount?: number, sourceChars?: number) {
  const chars = plainLength(md)
  const headings = findHeadings(md)
  const tables = (md.match(/^\|.*\|\s*$/gm) ?? []).length
  const images = (md.match(/!\[[^\]]*\]\([^)]*\)/g) ?? []).length
  const formulas = (md.match(/\$\$[\s\S]*?\$\$|\$[^$\n]+\$/g) ?? []).length

  const perPage = pageCount ? chars / Math.max(1, pageCount) : chars / 1200
  const textExtraction = pageCount
    ? clamp01(Math.max(0.65, Math.min(1, perPage / 700)))
    : sourceChars
      ? clamp01(0.55 + 0.45 * Math.min(1, chars / Math.max(1, sourceChars)))
      : 0.9

  const headingJump = diagnostics.some((d) => d.code === 'HEADING_JUMP')
  const structure = clamp01((headings.length ? 0.8 : 0.5) + Math.min(0.2, chapters.length / 40) - (headingJump ? 0.12 : 0))

  const avg = chapters.length ? chars / chapters.length : chars
  const chapterSplit =
    chapters.length <= 1
      ? chars > 3000
        ? 0.45
        : 0.72
      : clamp01(1 - Math.abs(avg - 2500) / 20000 - (chapters.length > 50 ? 0.15 : 0))

  const balanced = tables > 0 ? ((md.match(/^\|[\s:-]+\|\s*$/gm) ?? []).length > 0 ? 1 : 0.5) : 0.92
  const imageScore = images > 0 ? 0.95 : 0.9
  const formulaScore = 0.95

  const weights = { textExtraction: 0.3, structure: 0.25, chapterSplit: 0.15, tables: 0.12, images: 0.09, formulas: 0.09 }
  let overall =
    textExtraction * weights.textExtraction +
    structure * weights.structure +
    chapterSplit * weights.chapterSplit +
    balanced * weights.tables +
    imageScore * weights.images +
    formulaScore * weights.formulas
  for (const d of diagnostics) overall -= d.severity === 'high' ? 0.3 : d.severity === 'medium' ? 0.12 : 0.04
  overall = clamp01(overall)

  return {
    overall,
    scores: {
      textExtraction,
      structure,
      chapterSplit,
      tables: balanced,
      images: imageScore,
      formulas: formulaScore,
    },
  }
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0))
}
