import * as pdfjs from 'pdfjs-dist'
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { normalizeMarkdown, splitChapters } from './chapter'
import type { ParsedDraft } from './epub'
import type { Diagnostic } from '../../types'

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc

interface Line {
  y: number
  x: number
  size: number
  text: string
  bold: boolean
  page: number
  pageHeight: number
}

const CJK = /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/
const PAGE_NO = /^\s*[-—–]?\s*\d{1,4}\s*[-—–]?\s*$/
const HEADER_JUNK = /^(\d{4}[-/年]\d{1,2}[-/月]\d{1,2}日?.*\d{1,2}:\d{2}|\d{1,2}:\d{2}\s*$|https?:\/\/\S+)/

/** Chrome / macOS 导出的 PDF 常把汉字拆成康熙部首，需要做兼容映射 */
function fixCjkCompat(text: string): string {
  return text.replace(/[\u2E80-\u2FDF\uF900-\uFAFF]/g, (ch) => ch.normalize('NFKC'))
}
const CHAPTER_RE =
  /^(第\s*[〇零一二三四五六七八九十百千万两\d]+\s*[章节篇部卷回集]|chapter\s+\d+|part\s+[ivxlcdm\d]+|\d{1,3}(\.\d{1,3}){0,3}\s+\S|[一二三四五六七八九十]{1,3}[、.．]\s*\S|序[言章]|前言|后记|附录)/i

export async function parsePdf(buf: ArrayBuffer, fileName: string): Promise<ParsedDraft> {
  const diagnostics: Diagnostic[] = []
  const task = pdfjs.getDocument({ data: new Uint8Array(buf), isEvalSupported: false })
  const doc = await task.promise
  const pages: Line[][] = []
  const pageTextCount: number[] = []

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p)
    const content = await page.getTextContent()
    const pageHeight = page.view[3] ?? 800
    const items: { x: number; y: number; size: number; text: string; bold: boolean }[] = []
    for (const raw of content.items as any[]) {
      if (typeof raw.str !== 'string' || !raw.str.trim()) continue
      const transform = raw.transform as number[]
      const fontName: string = raw.fontName ?? ''
      const style = (content.styles as any)?.[fontName]
      const fontFamily: string = style?.fontFamily ?? fontName
      items.push({
        x: transform[4],
        y: transform[5],
        size: Math.abs(raw.height ?? transform[3] ?? 10),
        text: raw.str,
        bold: /bold|heavy|black|semibold|medium|,B|黑体|粗/i.test(fontFamily + fontName),
      })
    }
    pageTextCount.push(items.reduce((n, i) => n + i.text.trim().length, 0))
    // 行分组
    items.sort((a, b) => b.y - a.y || a.x - b.x)
    const lines: Line[] = []
    for (const item of items) {
      const tol = Math.max(2, item.size * 0.45)
      const last = lines[lines.length - 1]
      if (last && Math.abs(last.y - item.y) <= tol) {
        const gap = item.x - last.x
        const needSpace = gap > item.size * 1.5 && !CJK.test(item.text[0] ?? '') && !CJK.test(last.text.slice(-1))
        last.text += `${needSpace ? ' ' : ''}${item.text}`
        last.size = Math.max(last.size, item.size)
        last.bold = last.bold || item.bold
        last.x = item.x
      } else {
        lines.push({ y: item.y, x: item.x, size: item.size, text: item.text, bold: item.bold, page: p, pageHeight })
      }
    }
    pages.push(lines)
    page.cleanup()
  }

  const totalChars = pageTextCount.reduce((a, b) => a + b, 0)
  if (totalChars < doc.numPages * 25) {
    throw new Error('该 PDF 没有可提取的文本层，疑似扫描件。当前版本未启用 OCR，请先用 OCR 工具转换后再导入。')
  }

  const allSizes = pages.flat().map((l) => l.size)
  const bodySize = median(allSizes)
  if (bodySize <= 0) throw new Error('PDF 解析失败：无法确定正文字号')

  // 重复页眉页脚（数字归一化后高频出现）
  const freq = new Map<string, number>()
  for (const lines of pages) {
    const edge = lines.filter((l) => l.y > l.pageHeight * 0.9 || l.y < l.pageHeight * 0.08)
    for (const l of edge) {
      const key = l.text.replace(/\d+/g, '#').trim()
      if (key.length > 2) freq.set(key, (freq.get(key) ?? 0) + 1)
    }
  }
  const repeated = new Set([...freq.entries()].filter(([, n]) => n >= Math.max(2, Math.ceil(pages.length * 0.3))).map(([k]) => k))

  // 标题聚类
  const headingLines = pages.flat().filter((l) => isHeading(l, bodySize))
  const headingSizes = [...new Set(headingLines.map((l) => Math.round(l.size)))].sort((a, b) => b - a)
  const sizeToLevel = new Map<number, number>()
  headingSizes.slice(0, 4).forEach((s, i) => sizeToLevel.set(s, Math.min(4, i + 1)))

  const bookTitle = fileName.replace(/\.pdf$/i, '')
  const blocks: string[] = []
  let paragraph: string[] = []
  let lastLine: Line | null = null

  const flush = () => {
    if (!paragraph.length) return
    const text = joinLines(paragraph)
    if (text.trim()) blocks.push(text.trim())
    paragraph = []
  }

  for (const lines of pages) {
    const bodyLines = lines.filter((l) => {
      if (PAGE_NO.test(l.text)) return false
      if (repeated.has(l.text.replace(/\d+/g, '#').trim())) return false
      return l.text.trim().length > 0
    })
    bodyLines.sort((a, b) => b.y - a.y)
    for (const line of bodyLines) {
      const text = fixCjkCompat(line.text).replace(/\s+/g, ' ').trim()
      if (!text) continue
      const nearEdge = line.y > line.pageHeight * 0.94 || line.y < line.pageHeight * 0.06
      if (nearEdge && (PAGE_NO.test(text) || HEADER_JUNK.test(text))) continue
      if (isHeading(line, bodySize) && text.length <= 80) {
        flush()
        if (normalizeForCompare(text) === normalizeForCompare(bookTitle)) {
          lastLine = line
          continue
        }
        const level = sizeToLevel.get(Math.round(line.size)) ?? 2
        blocks.push(`${'#'.repeat(Math.min(4, Math.max(1, level)))} ${text}`)
        lastLine = line
        continue
      }
      const gap = lastLine ? lastLine.y - line.y : 0
      const newParagraph = !lastLine || gap > bodySize * 2.1 || lastLine.page !== line.page
      if (newParagraph) flush()
      paragraph.push(text)
      lastLine = line
    }
    flush()
    lastLine = null
  }

  const md = normalizeMarkdown(`# ${bookTitle}\n\n${blocks.join('\n\n')}\n`)
  const chapters = splitChapters(md)

  if (chapters.length <= 1) {
    diagnostics.push({ code: 'NO_CHAPTER_HEADING', severity: 'low', message: '未识别到可靠的章节标题，已作为单篇导入' })
  }
  diagnostics.push({ code: 'PDF_NO_OCR', severity: 'low', message: 'PDF 中的图片、表格无法还原为结构化内容' })
  if (headingLines.length > 200) {
    diagnostics.push({ code: 'MANY_HEADINGS', severity: 'low', message: `检出 ${headingLines.length} 个候选标题，已按字号聚类收敛` })
  }

  const result = {
    importer: 'pdf' as const,
    tier: 'C' as const,
    title: bookTitle,
    markdown: md,
    chapters,
    assets: [],
    diagnostics,
    originalText: pages.flat().map((l) => l.text).join('\n'),
    pageCount: doc.numPages,
  }
  // pdfjs 的 worker/字体缓存不会自动释放；导入完成后显式销毁，避免连续导入大 PDF 内存只增不减。
  await task.destroy().catch(() => undefined)
  return result
}

function isHeading(line: Line, bodySize: number): boolean {
  const text = fixCjkCompat(line.text).trim()
  if (!text || text.length > 80) return false
  if (PAGE_NO.test(text)) return false
  const bigger = line.size >= bodySize * 1.16
  const bold = line.bold && line.size >= bodySize * 0.98
  const numbered = CHAPTER_RE.test(text)
  const sentenceEnd = /[。！？；.!?;：:,，]$/.test(text)
  if (numbered && (bigger || bold || line.size >= bodySize * 1.02)) return true
  if (bigger && !sentenceEnd) return true
  if (bold && !sentenceEnd && text.length <= 40) return true
  return false
}

function joinLines(lines: string[]): string {
  let out = ''
  for (const line of lines) {
    if (!out) {
      out = line
      continue
    }
    const lastChar = out.slice(-1)
    const firstChar = line[0] ?? ''
    const needSpace = !CJK.test(lastChar) && !CJK.test(firstChar) && !/[（“‘(\[]$/.test(lastChar)
    out += `${needSpace ? ' ' : ''}${line}`
  }
  return out
    .replace(/([A-Za-z])-\s+([a-z])/g, '$1$2')
    .replace(/\s+([,.;:!?，。；：！？])/g, '$1')
}

function normalizeForCompare(s: string): string {
  return s.replace(/[\s·•:：.\-—_]/g, '').toLowerCase()
}

function median(nums: number[]): number {
  if (!nums.length) return 0
  const sorted = [...nums].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

export async function destroyPdf() {
  // 预留：批量导入结束时释放 worker
}
