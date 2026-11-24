import mammoth from 'mammoth/mammoth.browser'
import { htmlToMarkdown } from './html'
import { normalizeMarkdown, splitChapters } from './chapter'
import type { ParsedDraft } from './epub'
import type { Diagnostic } from '../../types'

export async function parseDocx(buf: ArrayBuffer, fileName: string): Promise<ParsedDraft> {
  const diagnostics: Diagnostic[] = []
  const { value: html, messages } = await mammoth.convertToHtml({ arrayBuffer: buf })
  for (const m of messages.slice(0, 5)) {
    if (m.type === 'warning') diagnostics.push({ code: 'DOCX_WARNING', severity: 'low', message: m.message })
  }
  const md = normalizeMarkdown(htmlToMarkdown(html))
  if (md.replace(/\s/g, '').length < 40) throw new Error('DOCX 中未解析出正文内容')
  const title = fileName.replace(/\.docx$/i, '')
  const body = /^#\s+/.test(md) ? md : `# ${title}\n\n${md}`
  return {
    importer: 'docx',
    tier: 'B',
    title,
    markdown: normalizeMarkdown(body),
    chapters: splitChapters(body),
    assets: [],
    diagnostics,
    originalText: md,
  }
}
