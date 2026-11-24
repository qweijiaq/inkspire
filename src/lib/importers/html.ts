/** HTML → Markdown（确定性转换，保留标题/列表/表格/代码/图片/公式） */

const NOISE = 'script,style,noscript,nav,footer,header,aside,form,iframe,svg,canvas,button,input,select,textarea,[aria-hidden="true"],[role="navigation"],[role="banner"],[role="complementary"]'

export function cleanHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll(NOISE).forEach((el) => el.remove())
  return doc.body?.innerHTML ?? ''
}

/** 从整页 HTML 中挑选正文容器：按段落文字量与链接密度打分 */
export function extractMainHtml(html: string): { html: string; title?: string } {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll(NOISE).forEach((el) => el.remove())
  const title = doc.querySelector('h1')?.textContent?.trim() || doc.title?.trim()

  const candidates = [doc.body, ...Array.from(doc.querySelectorAll('article,main,[role="main"],.content,.post,.article,.markdown-body,#content'))]
  let best: { el: Element; score: number } | null = null
  for (const el of candidates) {
    if (!el) continue
    const text = (el.textContent ?? '').replace(/\s+/g, '')
    if (text.length < 80) continue
    const linkText = Array.from(el.querySelectorAll('a')).reduce((n, a) => n + (a.textContent?.length ?? 0), 0)
    const paragraphs = el.querySelectorAll('p').length
    const score = text.length * (1 - Math.min(0.7, linkText / Math.max(1, text.length))) + paragraphs * 40
    if (!best || score > best.score) best = { el, score }
  }
  const root = best?.el ?? doc.body
  return { html: root?.innerHTML ?? '', title }
}

interface Ctx {
  images: Map<string, string>
  depth: number
}

export function htmlToMarkdown(html: string, images = new Map<string, string>()): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const ctx: Ctx = { images, depth: 0 }
  const md = serializeChildren(doc.body, ctx)
  return postProcess(md)
}

export function collectImageSrcs(html: string): string[] {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const out = new Set<string>()
  doc.querySelectorAll('img[src]').forEach((img) => {
    const src = img.getAttribute('src')?.trim()
    if (src && !src.startsWith('data:')) out.add(src)
  })
  return [...out]
}

function serializeChildren(el: Node, ctx: Ctx): string {
  let out = ''
  el.childNodes.forEach((node) => {
    out += serializeNode(node, ctx)
  })
  return out
}

function serializeNode(node: Node, ctx: Ctx): string {
  if (node.nodeType === Node.TEXT_NODE) return escapeText(node.textContent ?? '')
  if (node.nodeType !== Node.ELEMENT_NODE) return ''
  const el = node as HTMLElement
  const tag = el.tagName.toLowerCase()
  switch (tag) {
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6': {
      const level = Number(tag.slice(1))
      // 标题里的 EPUB 内部锚点/跳转链接在正文里没有意义，只保留纯文字。
      const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim() || inline(el, ctx).trim()
      return `\n\n${'#'.repeat(level)} ${text}\n\n`
    }
    case 'p':
      return `\n\n${inline(el, ctx).trim()}\n\n`
    case 'br':
      return '  \n'
    case 'hr':
      return '\n\n---\n\n'
    case 'strong':
    case 'b':
      return `**${inline(el, ctx).trim()}**`
    case 'em':
    case 'i':
      return `*${inline(el, ctx).trim()}*`
    case 'del':
    case 's':
    case 'strike':
      return `~~${inline(el, ctx).trim()}~~`
    case 'mark':
      return `==${inline(el, ctx).trim()}==`
    case 'code': {
      const text = el.textContent ?? ''
      const fence = text.includes('`') ? '``' : '`'
      return `${fence}${text.trim()}${fence}`
    }
    case 'pre': {
      const codeEl = el.querySelector('code')
      const cls = `${codeEl?.className ?? ''} ${el.className}`.match(/(?:language|lang)-([\w+-]+)/)?.[1] ?? ''
      const text = (codeEl ?? el).textContent?.replace(/\n$/, '') ?? ''
      const fence = text.includes('```') ? '````' : '```'
      return `\n\n${fence}${cls}\n${text}\n${fence}\n\n`
    }
    case 'blockquote': {
      const inner = serializeChildren(el, ctx).trim()
      const quoted = inner
        .split('\n')
        .map((l) => (l.trim() ? `> ${l}` : '>'))
        .join('\n')
      return `\n\n${quoted}\n\n`
    }
    case 'ul':
    case 'ol': {
      const ordered = tag === 'ol'
      const start = Number(el.getAttribute('start') ?? 1)
      let index = start
      const items = Array.from(el.children).filter((c) => c.tagName.toLowerCase() === 'li')
      const lines = items.map((li) => {
        const marker = ordered ? `${index++}. ` : '- '
        const indent = '  '.repeat(ctx.depth)
        const content = serializeChildren(li, { ...ctx, depth: ctx.depth + 1 })
          .replace(/\n{3,}/g, '\n\n')
          .trim()
          .split('\n')
          .map((l, i) => (i === 0 ? l : l.trim() ? `${indent}  ${l}` : l))
          .join('\n')
        return `${indent}${marker}${content}`
      })
      return `\n\n${lines.join('\n')}\n\n`
    }
    case 'li':
      return serializeChildren(el, ctx)
    case 'a': {
      const href = el.getAttribute('href')?.trim() ?? ''
      const text = inline(el, ctx).trim()
      if (!text) return ''
      if (!href || href.startsWith('javascript:') || href.startsWith('#')) return text
      return `[${text}](${href})`
    }
    case 'img': {
      const src = el.getAttribute('src') ?? ''
      const alt = el.getAttribute('alt') ?? ''
      const resolved = ctx.images.get(src) ?? (src.startsWith('data:') ? src : '')
      return resolved ? `![${alt}](${resolved})` : ''
    }
    case 'figure': {
      const img = el.querySelector('img')
      const cap = el.querySelector('figcaption')?.textContent?.trim()
      let out = ''
      if (img) out += serializeNode(img, ctx)
      if (cap) out += `\n\n*${cap}*\n\n`
      return out
    }
    case 'table':
      return convertTable(el, ctx)
    case 'div':
    case 'section':
    case 'article':
    case 'main':
    case 'body':
      return `\n${serializeChildren(el, ctx)}\n`
    case 'plus':
      return '+'
    case 'sup':
      return `^${inline(el, ctx)}$`
    case 'sub':
      return `~${inline(el, ctx)}~`
    case 'dl':
      return `\n\n${Array.from(el.children)
        .map((c) => (c.tagName.toLowerCase() === 'dt' ? `**${c.textContent?.trim()}**` : `: ${c.textContent?.trim()}`))
        .join('\n\n')}\n\n`
    default:
      return serializeChildren(el, ctx)
  }
}

function inline(el: Element, ctx: Ctx): string {
  return serializeChildren(el, ctx).replace(/\n+/g, ' ').replace(/\s{2,}/g, ' ')
}

function convertTable(el: Element, ctx: Ctx): string {
  const rows = Array.from(el.querySelectorAll('tr'))
  if (!rows.length) return ''
  const cells = (tr: Element) => Array.from(tr.querySelectorAll('th,td')).map((c) => inline(c, ctx).replace(/\|/g, '\\|').trim())
  const headerRow = rows[0]
  const header = cells(headerRow)
  const aligns = Array.from(headerRow.querySelectorAll('th,td')).map((c) => {
    const style = c.getAttribute('style') ?? ''
    const align = c.getAttribute('align') ?? style.match(/text-align:\s*(left|center|right)/)?.[1] ?? ''
    return align === 'center' ? ':---:' : align === 'right' ? '---:' : '---'
  })
  const bodyRows = rows.slice(1).map(cells)
  const width = Math.max(header.length, ...bodyRows.map((r) => r.length))
  const pad = (r: string[]) => Array.from({ length: width }, (_, i) => r[i] ?? '')
  const lines = [
    `| ${pad(header).join(' | ')} |`,
    `| ${Array.from({ length: width }, (_, i) => aligns[i] ?? '---').join(' | ')} |`,
    ...bodyRows.map((r) => `| ${pad(r).join(' | ')} |`),
  ]
  return `\n\n${lines.join('\n')}\n\n`
}

function escapeText(text: string): string {
  return text
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^(\s*)([#>+\-*]|\d+\.)\s/gm, '$1\\$2 ')
}

function postProcess(md: string): string {
  return md
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\s+|\s+$/g, '')
    .concat('\n')
}
