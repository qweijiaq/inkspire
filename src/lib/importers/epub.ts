import JSZip from 'jszip'
import { htmlToMarkdown, collectImageSrcs } from './html'
import { findHeadings, normalizeMarkdown, splitChapters, MIN_CHAPTER } from './chapter'
import type { ChapterDraft, Diagnostic, QualityTier } from '../../types'

export interface ParsedDraft {
  importer: string
  fm?: import('../../types').FrontMatter
  tier: QualityTier
  markdown: string
  chapters: ChapterDraft[]
  assets: { name: string; dataUrl: string }[]
  diagnostics: Diagnostic[]
  originalText: string
  pageCount?: number
  title?: string
}

function byTag(root: Document | Element, name: string): Element[] {
  const all = Array.from(root.getElementsByTagName('*'))
  return all.filter((el) => el.localName?.toLowerCase() === name)
}

function parseXml(text: string): Document {
  return new DOMParser().parseFromString(text, 'application/xml')
}

function dirOf(path: string): string {
  const i = path.lastIndexOf('/')
  return i === -1 ? '' : path.slice(0, i)
}

export function resolvePath(base: string, rel: string): string {
  const clean = decodeURIComponent(rel.split('#')[0])
  if (/^[a-z]+:/i.test(clean)) return clean
  const parts = `${base ? `${base}/` : ''}${clean}`.split('/')
  const out: string[] = []
  for (const p of parts) {
    if (!p || p === '.') continue
    if (p === '..') out.pop()
    else out.push(p)
  }
  return out.join('/')
}

function mimeOf(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    webp: 'image/webp',
  }
  return map[ext] ?? 'application/octet-stream'
}

export async function parseEpub(buf: ArrayBuffer): Promise<ParsedDraft> {
  const zip = await JSZip.loadAsync(buf)
  const diagnostics: Diagnostic[] = []
  const containerFile = zip.file('META-INF/container.xml')
  if (!containerFile) throw new Error('不是有效的 EPUB：缺少 META-INF/container.xml')
  const container = parseXml(await containerFile.async('string'))
  const rootfile = byTag(container, 'rootfile')[0]?.getAttribute('full-path')
  if (!rootfile) throw new Error('不是有效的 EPUB：缺少 rootfile')
  const opfText = await zip.file(rootfile)?.async('string')
  if (!opfText) throw new Error('EPUB 结构损坏：找不到 OPF 文件')
  const opf = parseXml(opfText)
  const opfDir = dirOf(rootfile)

  const title = byTag(opf, 'title')[0]?.textContent?.trim() || '未命名书籍'
  const manifest = new Map<string, { href: string; mediaType: string; properties: string }>()
  for (const item of byTag(opf, 'item')) {
    const id = item.getAttribute('id')
    const href = item.getAttribute('href')
    if (!id || !href) continue
    manifest.set(id, { href: resolvePath(opfDir, href), mediaType: item.getAttribute('media-type') ?? '', properties: item.getAttribute('properties') ?? '' })
  }
  const spine = byTag(opf, 'itemref')
    .map((r) => manifest.get(r.getAttribute('idref') ?? ''))
    .filter((x): x is { href: string; mediaType: string; properties: string } => !!x)

  // 目录：nav.xhtml 优先，回退 NCX
  const tocMap = new Map<string, string>()
  const navItem = [...manifest.values()].find((m) => /nav/.test(m.properties))
  if (navItem) {
    const navHtml = await zip.file(navItem.href)?.async('string')
    if (navHtml) {
      const navDoc = new DOMParser().parseFromString(navHtml, 'text/html')
      navDoc.querySelectorAll('nav a[href], a[href]').forEach((a) => {
        const href = a.getAttribute('href')
        if (!href) return
        const target = resolvePath(dirOf(navItem.href), href)
        const label = a.textContent?.replace(/\s+/g, ' ').trim()
        if (label && !tocMap.has(target)) tocMap.set(target, label)
      })
    }
  }
  if (!tocMap.size) {
    const ncx = [...manifest.values()].find((m) => m.mediaType.includes('dtbncx'))
    if (ncx) {
      const ncxText = await zip.file(ncx.href)?.async('string')
      if (ncxText) {
        const ncxDoc = parseXml(ncxText)
        for (const point of byTag(ncxDoc, 'navpoint')) {
          const label = byTag(point, 'text')[0]?.textContent?.trim()
          const src = byTag(point, 'content')[0]?.getAttribute('src')
          if (label && src) tocMap.set(resolvePath(dirOf(ncx.href), src), label)
        }
      }
    }
  }

  const assets: { name: string; dataUrl: string }[] = []
  const imageCache = new Map<string, string>()
  let imageBudget = 24

  const resolveImages = async (html: string, baseDir: string) => {
    const map = new Map<string, string>()
    for (const src of collectImageSrcs(html)) {
      const path = resolvePath(baseDir, src)
      const cached = imageCache.get(path)
      if (cached) {
        map.set(src, cached)
        continue
      }
      if (imageBudget <= 0) continue
      const file = zip.file(path)
      if (!file) {
        diagnostics.push({ code: 'IMAGE_DEAD_LINK', severity: 'low', message: `图片丢失：${path}` })
        continue
      }
      const blob = await file.async('uint8array')
      if (blob.byteLength > 600_000) continue
      const dataUrl = `data:${mimeOf(path)};base64,${toBase64(blob)}`
      imageCache.set(path, dataUrl)
      map.set(src, dataUrl)
      assets.push({ name: path.split('/').pop() ?? 'image', dataUrl })
      imageBudget--
    }
    return map
  }

  const chapters: { title: string; body: string }[] = []
  let index = 0
  for (const item of spine) {
    if (!/xhtml|html/.test(item.mediaType) && !/\.x?html?$/i.test(item.href)) continue
    const raw = await zip.file(item.href)?.async('string')
    if (!raw) continue
    const doc = new DOMParser().parseFromString(raw, 'text/html')
    doc.querySelectorAll('script,style,noscript').forEach((el) => el.remove())
    const images = await resolveImages(doc.body?.innerHTML ?? '', dirOf(item.href))
    let body = htmlToMarkdown(doc.body?.innerHTML ?? '', images)
    if (body.replace(/\s/g, '').length < 40) continue
    body = stripPageNoise(body)
    const first = findHeadings(body)[0]
    const tocTitle = tocMap.get(item.href)
    const chapterTitle = (tocTitle || first?.text || `第 ${++index} 节`).replace(/\s+/g, ' ').trim()
    if (first && first.level <= 2 && normalize(first.text) === normalize(chapterTitle)) {
      body = body.split('\n').slice(first.line + 1).join('\n').trim()
    }
    chapters.push({ title: chapterTitle, body })
  }

  if (!chapters.length) throw new Error('EPUB 中没有可解析的正文')

  // 短章合并：避免"一句话一章"
  const merged: { title: string; body: string }[] = []
  for (const ch of chapters) {
    const prev = merged[merged.length - 1]
    if (prev && plainLen(prev.body) < MIN_CHAPTER) {
      prev.body = `${prev.body}\n\n${ch.body}`
    } else merged.push({ ...ch })
  }

  const fullMd = `# ${title}\n\n${merged.map((c) => `## ${c.title}\n\n${c.body}`).join('\n\n')}\n`
  let drafts: ChapterDraft[] = merged.map((c) => ({ title: c.title, level: 2, markdown: ensureH1(c.body, c.title) }))
  // 若章节粒度明显不对（过多），交给通用切分器再平衡
  if (drafts.length > 60) {
    drafts = splitChapters(fullMd)
    diagnostics.push({ code: 'CHAPTER_REBALANCED', severity: 'low', message: `原始章节过多（${merged.length}），已按内容长度重新合并` })
  }

  return {
    importer: 'epub',
    tier: 'A',
    title,
    markdown: normalizeMarkdown(fullMd),
    chapters: drafts,
    assets,
    diagnostics,
    originalText: merged.map((c) => `${c.title}\n${c.body}`).join('\n'),
  }
}

function ensureH1(body: string, title: string): string {
  const t = body.trim()
  if (/^#\s+/.test(t)) return t
  return `# ${title}\n\n${t}`
}

function normalize(s: string): string {
  return s.replace(/[\s·•:：.\-—_]/g, '').toLowerCase()
}

function plainLen(s: string): number {
  return s.replace(/```[\s\S]*?```/g, ' ').replace(/[#>*_`~\-|\s]/g, '').length
}

function stripPageNoise(md: string): string {
  const lines = md.split('\n')
  const cleaned = lines.filter((l) => !/^\s*[-—–]?\s*\d{1,4}\s*[-—–]?\s*$/.test(l))
  return cleaned.join('\n').replace(/\n{3,}/g, '\n\n')
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}
