import JSZip from 'jszip'
import { extractMainHtml, htmlToMarkdown } from './html'
import { parseFrontMatter } from '../md'
import { buildDiagnostics, finalizeChapters, normalizeMarkdown, scoreQuality, splitChapters } from './chapter'
import type { ImportResult, QualityTier } from '../../types'
import type { ParsedDraft } from './epub'

export type ImportKind = 'md' | 'txt' | 'html' | 'docx' | 'pdf' | 'epub'

async function readText(file: File): Promise<string> {
  const buf = await file.arrayBuffer()
  const bytes = new Uint8Array(buf)
  let text = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  const replacement = (text.match(/\ufffd/g) ?? []).length
  if (replacement > Math.max(3, text.length * 0.005)) {
    for (const enc of ['gbk', 'big5', 'shift_jis']) {
      try {
        const alt = new TextDecoder(enc).decode(bytes)
        if ((alt.match(/\ufffd/g) ?? []).length < replacement) text = alt
      } catch {
        /* 浏览器不支持该编码则跳过 */
      }
    }
  }
  return text.replace(/^\ufeff/, '')
}

export async function detectKind(file: File): Promise<ImportKind> {
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer())
  const sig = String.fromCharCode(...head.slice(0, 4))
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (sig.startsWith('%PDF')) return 'pdf'
  if (head[0] === 0x50 && head[1] === 0x4b) {
    try {
      const zip = await JSZip.loadAsync(await file.arrayBuffer())
      if (zip.file('mimetype') || zip.file('META-INF/container.xml')) return 'epub'
      if (zip.file('word/document.xml')) return 'docx'
    } catch {
      /* 继续按扩展名判断 */
    }
    if (ext === 'epub') return 'epub'
    if (ext === 'docx') return 'docx'
  }
  if (['md', 'markdown', 'mdown'].includes(ext)) return 'md'
  if (['txt', 'text'].includes(ext)) return 'txt'
  if (['html', 'htm', 'xhtml'].includes(ext)) return 'html'
  if (ext === 'pdf') return 'pdf'
  if (ext === 'docx') return 'docx'
  if (ext === 'epub') return 'epub'
  return 'txt'
}

export async function importFile(file: File, onProgress?: (p: number) => void): Promise<ImportResult> {
  const kind = await detectKind(file)
  onProgress?.(0.15)
  let draft: ParsedDraft

  if (kind === 'pdf') {
    const { parsePdf } = await import('./pdf')
    draft = await parsePdf(await file.arrayBuffer(), file.name)
  } else if (kind === 'epub') {
    const { parseEpub } = await import('./epub')
    draft = await parseEpub(await file.arrayBuffer())
  } else if (kind === 'docx') {
    const { parseDocx } = await import('./docx')
    draft = await parseDocx(await file.arrayBuffer(), file.name)
  } else if (kind === 'html') {
    const raw = await readText(file)
    const main = extractMainHtml(raw)
    const md = normalizeMarkdown(htmlToMarkdown(main.html))
    if (md.replace(/\s/g, '').length < 40) throw new Error('HTML 中未提取到正文内容')
    const title = main.title || file.name.replace(/\.html?$/i, '')
    const body = /^#\s+/.test(md) ? md : `# ${title}\n\n${md}`
    draft = { importer: 'html', tier: 'B', title, markdown: normalizeMarkdown(body), chapters: splitChapters(body), assets: [], diagnostics: [], originalText: md }
  } else {
    const raw = await readText(file)
    const isMd = kind === 'md'
    const parsed = parseFrontMatter(raw)
    const fm = parsed.fmRaw ? parsed.fm : undefined
    const title = fm?.title || file.name.replace(/\.[^.]+$/, '')
    const body = parsed.body.trim() || `# ${title}\n`
    const md = normalizeMarkdown(/^#\s+/m.test(body) ? body : `# ${title}\n\n${body}`)
    draft = {
      importer: isMd ? 'markdown' : 'text',
      tier: isMd ? 'A' : 'B',
      title,
      fm,
      markdown: md,
      chapters: splitChapters(md),
      assets: [],
      diagnostics: [],
      originalText: parsed.body,
    }
  }

  onProgress?.(0.7)
  const h1 = draft.markdown.match(/^#\s+(.+)$/m)?.[1]?.replace(/[*_`]/g, '').trim()
  const docTitle = h1 || draft.title || file.name.replace(/\.[^.]+$/, '')
  draft.chapters = finalizeChapters(draft.chapters, docTitle)
  const diagnostics = buildDiagnostics(draft.markdown, draft.chapters, draft.diagnostics)
  // 纯 Markdown / 文本本来就可以很短，不该因为「内容过短」被当成解析失败
  const filteredDiagnostics = kind === 'md' || kind === 'txt'
    ? diagnostics.filter((d) => d.code !== 'CONTENT_TOO_SHORT')
    : diagnostics
  const quality = scoreQuality(draft.markdown, draft.chapters, filteredDiagnostics, draft.pageCount, draft.originalText.length)
  const stats = {
    characters: draft.markdown.replace(/\s/g, '').length,
    paragraphs: draft.markdown.split(/\n{2,}/).filter((p) => p.trim() && !p.startsWith('#')).length,
    headings: (draft.markdown.match(/^#{1,6}\s+/gm) ?? []).length,
    tables: (draft.markdown.match(/^\|.*\|\s*$/gm) ?? []).length,
    images: (draft.markdown.match(/!\[[^\]]*\]\([^)]*\)/g) ?? []).length,
    pageCount: draft.pageCount,
  }
  onProgress?.(1)

  return {
    fileName: file.name,
    frontMatter: draft.fm,
    importer: draft.importer,
    tier: (draft.tier ?? 'B') as QualityTier,
    markdown: draft.markdown,
    chapters: draft.chapters,
    assets: draft.assets,
    diagnostics: filteredDiagnostics,
    quality,
    stats,
    needsConfirmation:
      (kind === 'md' || kind === 'txt' || kind === 'html')
        ? quality.overall < 0.65 || filteredDiagnostics.some((d) => d.severity === 'high')
        : quality.overall < 0.9 || filteredDiagnostics.some((d) => d.severity === 'high'),
    originalText: draft.originalText,
  }
}

/** 把导入结果拆成可写入 vault 的文档 */
export function toDocuments(result: ImportResult, mode: 'merge' | 'split', baseDir = '导入') {
  const now = Date.now()
  const iso = new Date(now).toISOString()
  const safeTitle = (s: string) => s.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
  const src = result.frontMatter
  const fm = (title: string) => ({
    id: src?.id,
    title,
    tags: [...new Set([...(src?.tags ?? []), 'import'])],
    aliases: src?.aliases ?? [],
    date: src?.date,
    status: src?.status,
    created: src?.created || iso,
    updated: iso,
    author: src?.author,
    extra: src?.extra ?? {},
    source: { importer: result.importer, originalPath: result.fileName, importedAt: now },
  })

  if (mode === 'merge') {
    const title = safeTitle(result.chapters[0]?.title ?? result.fileName.replace(/\.[^.]+$/, ''))
    return [
      {
        path: `${baseDir}/${title}.md`,
        content: result.markdown,
        frontMatter: fm(title),
        importMeta: { importer: result.importer, originalName: result.fileName, quality: result.quality.overall, chapters: result.chapters.length, tier: result.tier },
      },
    ]
  }

  return result.chapters.map((ch, i) => {
    const title = safeTitle(ch.title || `第 ${i + 1} 节`)
    return {
      path: `${baseDir}/${title}.md`,
      content: ch.markdown,
      frontMatter: fm(title),
      importMeta: { importer: result.importer, originalName: result.fileName, quality: result.quality.overall, chapters: result.chapters.length, tier: result.tier },
    }
  })
}
