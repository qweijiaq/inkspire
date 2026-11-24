import MarkdownIt from 'markdown-it'
import JSZip from 'jszip'
import type { Document } from '../types'
import { parseFrontMatter } from './md'
import { figureExportSvg, parseFigureBlock, renderFigureSvg, svgToPngBlob } from './figures'
import { assetDataUrl } from './assets'

const md = new MarkdownIt({ html: false, linkify: true, typographer: true })
const defaultFence = md.renderer.rules.fence
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const token = tokens[idx]
  if ((token.info ?? '').trim().toLowerCase() === 'figure') {
    const spec = parseFigureBlock(token.content)
    if (spec) return `<div class="cm-md-figure figure-export">${renderFigureSvg(spec)}</div>`
  }
  return defaultFence ? defaultFence(tokens, idx, options, env, self) : self.renderToken(tokens, idx, options)
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function bodyOf(doc: Document): string {
  return parseFrontMatter(doc.content).body
}

function splitChapters(body: string, fallbackTitle: string): { title: string; text: string }[] {
  const lines = body.split('\n')
  const chapters: { title: string; text: string }[] = []
  let current: { title: string; lines: string[] } | null = null
  let preamble: string[] = []
  for (const line of lines) {
    const h2 = line.match(/^##\s+(.+)$/)
    if (h2) {
      if (current) chapters.push({ title: current.title, text: current.lines.join('\n') })
      current = { title: h2[1].trim(), lines: [] }
    } else if (current) {
      current.lines.push(line)
    } else {
      preamble.push(line)
    }
  }
  if (current) chapters.push({ title: current.title, text: current.lines.join('\n') })
  if (!chapters.length) return [{ title: fallbackTitle, text: body }]
  const pre = preamble.join('\n').trim()
  if (pre.replace(/^#\s+.*$/m, '').trim()) chapters.unshift({ title: '前言', text: pre })
  return chapters
}

const HTML_STYLE = `
:root{color-scheme:light}
body{max-width:760px;margin:48px auto;padding:0 24px;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;color:#2E2A3E;background:#FCF8F0;line-height:1.9;font-size:16px}
h1,h2,h3{color:#5A52C9;line-height:1.4}
h1{font-size:2em;border-bottom:3px solid #2E2A3E;padding-bottom:.3em}
h2{font-size:1.5em;margin-top:1.6em}
blockquote{background:#DDF5EE;border-left:4px solid #2FB79A;padding:.6em 1em;border-radius:0 10px 10px 0;margin:1em 0}
code{background:#F7F2E6;border:1px solid #E7DFCE;border-radius:5px;padding:.1em .35em;font-family:"SF Mono",Menlo,monospace;font-size:.9em}
pre{background:#F7F2E6;border:2px solid #E7DFCE;border-radius:12px;padding:14px;overflow:auto}
pre code{border:none;background:transparent}
table{border-collapse:collapse;width:100%;margin:1em 0}
th{background:#5A52C9;color:#fff}
th,td{border:1.5px solid #2E2A3E;padding:6px 10px;text-align:left}
img{max-width:100%;display:block;margin:1em auto;border:2px solid #2E2A3E;border-radius:12px}
a{color:#5A52C9}
hr{border:none;border-top:2px dashed #E7DFCE;margin:2em 0}
.meta{color:#9A94AC;font-size:12px;margin-bottom:24px}
`

const FIGURE_EXPORT_CSS = `
.cm-md-figure{--card:#FFFFFF;--ink:#2E2A3E;--ink-soft:#6C6680;--ink-faint:#9A94AC;--brand:#5A52C9;--brand-soft:#EEEAFE;--paper:#FCF8F0;--paper-2:#F6EFE0;--yellow:#FFC24A;--on-yellow:#2E2A3E;--coral:#FF7A66;--coral-soft:#FFE7E1;--line:#2E2A3E;--line-soft:#E7DFCE;--on-brand:#FFFFFF;border:2.5px solid #2E2A3E;border-radius:14px;background:#fff;overflow:hidden;margin:1.4em 0}
.cm-md-figure svg{display:block;width:100%;height:auto}
.cm-md-figure .fig-title{font-size:17px;font-weight:900;fill:#2E2A3E}
.cm-md-figure .fig-focus{font-size:11px;fill:#6C6680}
.cm-md-figure .fig-node rect{fill:#fff;stroke:#2E2A3E;stroke-width:2}
.cm-md-figure .fig-num{fill:#FFC24A;stroke:#2E2A3E;stroke-width:1.5}
.cm-md-figure .fig-num-text{font-size:11px;font-weight:900;fill:#2E2A3E;text-anchor:middle}
.cm-md-figure .fig-node-label{font-size:13px;font-weight:800;fill:#2E2A3E}
.cm-md-figure .fig-node-detail{font-size:10.5px;fill:#6C6680}
.cm-md-figure .fig-edge{stroke:#6C6680;stroke-width:2}
.cm-md-figure .fig-ann-title{font-size:10px;font-weight:800;fill:#9A94AC}
.cm-md-figure .fig-ann-dot{fill:#EEEAFE;stroke:#5A52C9;stroke-width:1.5}
.cm-md-figure .fig-ann-num{font-size:8px;font-weight:900;fill:#5A52C9;text-anchor:middle}
.cm-md-figure .fig-ann-text{font-size:10.5px;fill:#6C6680}
.cm-md-figure .fig-takeaway{fill:#EEEAFE;stroke:#5A52C9;stroke-width:1.5}
.cm-md-figure .fig-takeaway-label{font-size:10px;font-weight:900;fill:#5A52C9}
.cm-md-figure .fig-takeaway-text{font-size:11px;font-weight:700;fill:#2E2A3E}
.cm-md-figure .fig-compare-panel>rect:first-child{fill:#fff;stroke:#E7DFCE;stroke-width:2}
.cm-md-figure .fig-compare-head{fill:#EEEAFE}
.cm-md-figure .fig-compare-title{font-size:12px;font-weight:900;fill:#5A52C9}
.cm-md-figure .fig-bullet{fill:#FF7A66}
.cm-md-figure .fig-compare-item{font-size:11px;fill:#2E2A3E}
.cm-md-figure .fig-timeline-line{stroke:#E7DFCE;stroke-width:3}
.cm-md-figure .fig-timeline-dot{fill:#FFC24A;stroke:#2E2A3E;stroke-width:2}
.cm-md-figure .fig-timeline-time{font-size:10px;font-weight:900;fill:#5A52C9;text-anchor:middle}
.cm-md-figure .fig-timeline-label{font-size:11px;font-weight:800;fill:#2E2A3E;text-anchor:middle}
.cm-md-figure .fig-timeline-detail{font-size:9.5px;fill:#9A94AC;text-anchor:middle}
.cm-md-figure .fig-bar-label{font-size:11px;font-weight:800;fill:#2E2A3E}
.cm-md-figure .fig-bar-track{fill:#F6EFE0;stroke:#E7DFCE}
.cm-md-figure .fig-bar-fill{fill:#5A52C9}
.cm-md-figure .fig-bar-value{font-size:12px;font-weight:900;fill:#2E2A3E}
.cm-md-figure .fig-bar-note{font-size:9.5px;fill:#9A94AC}
.cm-md-figure .fig-arch-layer{fill:#fff;stroke:#E7DFCE;stroke-width:2}
.cm-md-figure .fig-arch-title-bg{fill:#EEEAFE}
.cm-md-figure .fig-arch-title{font-size:12px;font-weight:900;fill:#5A52C9}
.cm-md-figure .fig-arch-chip{fill:#FCF8F0;stroke:#E7DFCE;stroke-width:1.2}
.cm-md-figure .fig-arch-item{font-size:10px;fill:#6C6680}
.cm-md-figure .fig-concept-edge{stroke:#E7DFCE;stroke-width:1.8}
.cm-md-figure .fig-concept-node{fill:#fff;stroke:#5A52C9;stroke-width:2.2}
.cm-md-figure .fig-concept-node.hub{fill:#5A52C9;stroke:#2E2A3E;stroke-width:2.5}
.cm-md-figure .fig-concept-label{font-size:11px;font-weight:800;fill:#2E2A3E;text-anchor:middle}
.cm-md-figure .fig-concept-node.hub+.fig-concept-label{fill:#fff}
`

export function renderHtmlBody(doc: Document): string {
  return md.render(bodyOf(doc))
}

export function buildHtml(doc: Document, forPrint = false): string {
  const body = renderHtmlBody(doc)
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${esc(doc.title)}</title><style>${HTML_STYLE}${FIGURE_EXPORT_CSS}${forPrint ? '@media print{body{background:#fff;margin:0}}' : ''}</style></head><body><h1>${esc(doc.title)}</h1><div class="meta">Inkspire · ${new Date(doc.updatedAt).toLocaleString()}</div>${body}</body></html>`
}

async function inlineAssets(html: string): Promise<string> {
  const paths = [...new Set([...html.matchAll(/<img[^>]+src="(assets\/[^"]+)"/g)].map((m) => m[1]))]
  let out = html
  for (const path of paths) {
    const data = await assetDataUrl(path)
    if (!data) continue
    out = out.split(`src="${path}"`).join(`src="${data}"`)
  }
  return out
}

export async function buildHtmlWithAssets(doc: Document, forPrint = false): Promise<string> {
  return inlineAssets(buildHtml(doc, forPrint))
}

export async function htmlBlob(doc: Document): Promise<{ blob: Blob; name: string }> {
  const html = await buildHtmlWithAssets(doc)
  return { blob: new Blob([html], { type: 'text/html;charset=utf-8' }), name: `${doc.title}.html` }
}

export function markdownBlob(doc: Document): { blob: Blob; name: string } {
  return { blob: new Blob([doc.content], { type: 'text/markdown;charset=utf-8' }), name: `${doc.title}.md` }
}

/* ------------------------------- EPUB ------------------------------- */

export async function epubBlob(doc: Document): Promise<{ blob: Blob; name: string }> {
  const chapters = splitChapters(bodyOf(doc), doc.title)
  const zip = new JSZip()
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
  )
  const manifest = chapters.map((c, i) => `<item id="c${i + 1}" href="c${i + 1}.xhtml" media-type="application/xhtml+xml"/>`).join('')
  const spine = chapters.map((_, i) => `<itemref idref="c${i + 1}"/>`).join('')
  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="bookid">inkspire-${Date.now()}</dc:identifier><dc:title>${esc(doc.title)}</dc:title><dc:language>zh-CN</dc:language></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="css" href="style.css" media-type="text/css"/>${manifest}</manifest><spine>${spine}</spine></package>`,
  )
  const nav = chapters.map((c, i) => `<li><a href="c${i + 1}.xhtml">${esc(c.title)}</a></li>`).join('')
  zip.file(
    'OEBPS/nav.xhtml',
    `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>目录</title></head><body><nav epub:type="toc"><h1>目录</h1><ol>${nav}</ol></nav></body></html>`,
  )
  zip.file('OEBPS/style.css', `body{font-family:"PingFang SC",serif;line-height:1.9;margin:5%}h1{font-size:1.6em}h2{font-size:1.3em;border-bottom:1px solid #ddd}blockquote{border-left:3px solid #2FB79A;padding-left:1em;color:#555}code{background:#f4f1e8;padding:.1em .3em;border-radius:4px}img{display:block;margin:1em auto;max-width:100%}${FIGURE_EXPORT_CSS}`)
  for (let i = 0; i < chapters.length; i++) {
    const c = chapters[i]
    const chapterBody = await inlineAssets(md.render(c.text))
    zip.file(
      `OEBPS/c${i + 1}.xhtml`,
      `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${esc(c.title)}</title><link rel="stylesheet" href="style.css"/></head><body><h1>${esc(c.title)}</h1>${chapterBody}</body></html>`,
    )
  }
  const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/epub+zip' })
  return { blob, name: `${doc.title}.epub` }
}

/* ------------------------------- DOCX ------------------------------- */

interface DocxMedia {
  name: string
  bytes: Uint8Array
}

const DOCX_EMU_PER_INCH = 914400
const DOCX_MAX_WIDTH = 6 * DOCX_EMU_PER_INCH

function bytesFromDataUrl(dataUrl: string): { mime: string; bytes: Uint8Array } | null {
  const match = dataUrl.match(/^data:([^;,]+)(;base64)?,([\s\S]*)$/)
  if (!match) return null
  const mime = match[1].toLowerCase()
  if (match[2]) {
    try {
      const binary = atob(match[3])
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      return { mime, bytes }
    } catch {
      return null
    }
  }
  return { mime, bytes: new TextEncoder().encode(decodeURIComponent(match[3])) }
}

function imagePixelSize(bytes: Uint8Array, mime: string): { width: number; height: number } | null {
  if (bytes.length < 10) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (mime.includes('png') && bytes.length >= 24) {
    const width = view.getUint32(16)
    const height = view.getUint32(20)
    if (width && height) return { width, height }
  }
  if (mime.includes('gif')) {
    const width = view.getUint16(6, true)
    const height = view.getUint16(8, true)
    if (width && height) return { width, height }
  }
  if (mime.includes('jpeg') || mime.includes('jpg')) {
    let offset = 2
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1
        continue
      }
      const marker = bytes[offset + 1]
      const length = view.getUint16(offset + 2)
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        const height = view.getUint16(offset + 5)
        const width = view.getUint16(offset + 7)
        if (width && height) return { width, height }
      }
      offset += 2 + length
    }
  }
  return null
}

function extForMime(mime: string): string {
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg'
  if (mime.includes('gif')) return 'gif'
  if (mime.includes('webp')) return 'webp'
  if (mime.includes('svg')) return 'svg'
  return 'png'
}

function contentTypeForExt(ext: string): string {
  switch (ext) {
    case 'jpg':
      return 'image/jpeg'
    case 'gif':
      return 'image/gif'
    case 'webp':
      return 'image/webp'
    case 'svg':
      return 'image/svg+xml'
    default:
      return 'image/png'
  }
}

function docxImageParagraph(relId: string, mediaName: string, size: { width: number; height: number } | null, alt: string, id: number): string {
  const ratio = size && size.height ? size.width / size.height : 4 / 3
  let cx = DOCX_MAX_WIDTH
  let cy = Math.round(cx / ratio)
  const maxHeight = 8 * DOCX_EMU_PER_INCH
  if (cy > maxHeight) {
    cy = maxHeight
    cx = Math.round(cy * ratio)
  }
  const descr = esc(alt || mediaName)
  return `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="Picture ${id}" descr="${descr}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="${esc(mediaName)}" descr="${descr}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`
}

export async function docxBlob(doc: Document): Promise<{ blob: Blob; name: string }> {
  const body = bodyOf(doc)
  const lines = body.split('\n')
  const paras: string[] = []
  const media: DocxMedia[] = []
  const imageRels: string[] = []
  let inCode = false
  const run = (text: string, opts: { bold?: boolean; style?: string; mono?: boolean } = {}) => {
    const rpr = `${opts.bold ? '<w:b/>' : ''}${opts.mono ? '<w:rFonts w:ascii="Menlo" w:hAnsi="Menlo"/>' : ''}`
    const ppr = opts.style ? `<w:pPr><w:pStyle w:val="${opts.style}"/></w:pPr>` : ''
    return `<w:p>${ppr}<w:r>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ''}<w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`
  }
  const addImage = (bytes: Uint8Array, mime: string, alt: string): boolean => {
    const ext = extForMime(mime)
    const name = `image${media.length + 1}.${ext}`
    media.push({ name, bytes })
    const relId = `rId${media.length + 1}`
    imageRels.push(`<Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${name}"/>`)
    paras.push(docxImageParagraph(relId, name, imagePixelSize(bytes, mime), alt, media.length))
    return true
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const fence = line.match(/^\s*(```|~~~)\s*(\S*)\s*$/)
    if (fence) {
      if (fence[2].toLowerCase() === 'figure') {
        const buf: string[] = []
        i += 1
        while (i < lines.length && !/^\s*(```|~~~)/.test(lines[i])) {
          buf.push(lines[i])
          i += 1
        }
        const spec = parseFigureBlock(buf.join('\n'))
        if (!spec) continue
        try {
          const png = await svgToPngBlob(figureExportSvg(spec).svg, 2)
          addImage(new Uint8Array(await png.arrayBuffer()), 'image/png', spec.title)
        } catch {
          paras.push(run(`[图解：${spec.title}]`, { style: 'Quote' }))
        }
        continue
      }
      inCode = !inCode
      continue
    }
    if (inCode) {
      paras.push(run(line, { mono: true }))
      continue
    }
    const image = line.match(/^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)\s*$/)
    if (image) {
      const alt = image[1]
      const src = image[2]
      const dataUrl = src.startsWith('data:') ? src : src.startsWith('assets/') ? await assetDataUrl(src) : null
      const parsed = dataUrl ? bytesFromDataUrl(dataUrl) : null
      if (!parsed || !addImage(parsed.bytes, parsed.mime, alt)) {
        paras.push(run(`[图片：${alt || src}]`, { style: 'Quote' }))
      }
      continue
    }
    const h = line.match(/^(#{1,4})\s+(.+)$/)
    if (h) {
      paras.push(run(h[2], { style: h[1].length === 1 ? 'Heading1' : 'Heading2' }))
      continue
    }
    const li = line.match(/^\s*[-*+]\s+(.+)$/)
    if (li) {
      paras.push(run(`• ${li[1].replace(/\[[ xX]\]\s*/, '')}`))
      continue
    }
    if (/^\s*>\s?/.test(line)) {
      paras.push(run(line.replace(/^\s*>\s?/, ''), { style: 'Quote' }))
      continue
    }
    if (!line.trim()) continue
    paras.push(run(line.replace(/[*_`]/g, '')))
  }

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${paras.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`
  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:sz w:val="24"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:spacing w:before="240" w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="40"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:pPr><w:spacing w:before="200" w:after="100"/></w:pPr><w:rPr><w:b/><w:sz w:val="30"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:rPr><w:i/><w:color w:val="555555"/></w:rPr></w:style></w:styles>`
  const imageDefaults = [...new Set(media.map((m) => m.name.split('.').pop() ?? 'png'))]
    .map((ext) => `<Default Extension="${ext}" ContentType="${contentTypeForExt(ext)}"/>`)
    .join('')
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${imageDefaults}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`
  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>${imageRels.join('')}</Relationships>`

  const zip = new JSZip()
  zip.file('[Content_Types].xml', contentTypes)
  zip.file('_rels/.rels', rels)
  zip.file('word/document.xml', documentXml)
  zip.file('word/styles.xml', stylesXml)
  zip.file('word/_rels/document.xml.rels', docRels)
  for (const m of media) zip.file(`word/media/${m.name}`, m.bytes)
  const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
  return { blob, name: `${doc.title}.docx` }
}

/* ------------------------------- 保存 / 打印 ------------------------------- */

export function downloadBlob(blob: Blob, name: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 4000)
}

export async function printHtml(doc: Document) {
  const w = window.open('', '_blank')
  if (!w) return false
  const html = await buildHtmlWithAssets(doc, true)
  w.document.write(html)
  w.document.close()
  w.focus()
  setTimeout(() => w.print(), 400)
  return true
}
