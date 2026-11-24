import type { FrontMatter, Heading, WikiLink, DocStatus } from '../types'

/* ------------------------------------------------------------------ *
 * Front Matter（YAML 子集，未知字段保留在 extra，保证往返不丢）
 * ------------------------------------------------------------------ */

export const EMPTY_FM: FrontMatter = { tags: [], aliases: [], extra: {} }

function unquote(s: string): string {
  const t = s.trim()
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1)
  return t
}

function parseScalar(raw: string): unknown {
  const v = raw.trim()
  if (!v) return ''
  if (v.startsWith('[') && v.endsWith(']')) {
    const inner = v.slice(1, -1).trim()
    if (!inner) return []
    return inner.split(',').map((x) => unquote(x.trim().replace(/^["']|["']$/g, ''))).filter(Boolean)
  }
  if (v === 'true') return true
  if (v === 'false') return false
  if (v === 'null' || v === '~') return null
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v)
  return unquote(v)
}

export function parseFrontMatter(text: string): { fm: FrontMatter; body: string; fmRaw: string; bodyLineOffset: number } {
  const fm: FrontMatter = { tags: [], aliases: [], extra: {} }
  if (!/^---\r?\n/.test(text)) return { fm, body: text, fmRaw: '', bodyLineOffset: 0 }
  const end = text.indexOf('\n---', 4)
  if (end === -1) return { fm, body: text, fmRaw: '', bodyLineOffset: 0 }
  const fmRaw = text.slice(0, end + 4)
  const bodyStart = text.indexOf('\n', end + 4)
  const body = bodyStart === -1 ? '' : text.slice(bodyStart + 1)
  const bodyLineOffset = (fmRaw.match(/\n/g)?.length ?? 0) + 1
  const lines = fmRaw.split('\n').slice(1)
  let currentKey = ''
  let nested: Record<string, unknown> | null = null
  for (const line of lines) {
    if (!line.trim() || line.trim() === '---') continue
    const indent = line.match(/^\s*/)?.[0].length ?? 0
    const m = line.match(/^\s*([^:#][^:]*):\s?(.*)$/)
    if (indent === 0 && m) {
      currentKey = m[1].trim()
      nested = null
      const val = m[2]
      if (!val.trim()) {
        // 可能是块状列表或对象
        const maybeObj: Record<string, unknown> = {}
        ;(fm as any)[currentKey] = maybeObj
        nested = maybeObj
      } else {
        const parsed = parseScalar(val)
        if (currentKey === 'tags' || currentKey === 'aliases') {
          ;(fm as any)[currentKey] = Array.isArray(parsed) ? parsed.map(String) : [String(parsed)]
        } else if (['title', 'date', 'created', 'updated', 'author', 'id', 'status'].includes(currentKey)) {
          ;(fm as any)[currentKey] = parsed == null ? undefined : String(parsed)
        } else {
          fm.extra[currentKey] = parsed
        }
      }
      continue
    }
    if (indent > 0) {
      const lm = line.match(/^\s*-\s+(.*)$/)
      if (lm && currentKey) {
        if (nested && !Array.isArray((fm as any)[currentKey])) {
          ;(fm as any)[currentKey] = []
          nested = null
        }
        const arr = (fm as any)[currentKey]
        if (Array.isArray(arr)) arr.push(unquote(lm[1]))
        else if (nested) nested[lm[1]] = true
        continue
      }
      const km = line.match(/^\s+([^:]+):\s*(.*)$/)
      if (km) {
        if (!nested) {
          nested = {}
          ;(fm as any)[currentKey] = nested
        }
        nested[km[1].trim()] = parseScalar(km[2])
      }
    }
  }
  return { fm, body, fmRaw, bodyLineOffset }
}

const yamlScalar = (v: unknown): string => {
  if (v == null) return ''
  if (typeof v === 'string') return /[:#\[\]{}&*!|>'"%@`,]|^\s|\s$/.test(v) ? JSON.stringify(v) : v
  if (Array.isArray(v)) return `[${v.map((x) => String(x)).join(', ')}]`
  return String(v)
}

export function serializeFrontMatter(fm: FrontMatter): string {
  const lines: string[] = ['---']
  if (fm.id) lines.push(`id: ${yamlScalar(fm.id)}`)
  if (fm.title) lines.push(`title: ${yamlScalar(fm.title)}`)
  if (fm.tags?.length) lines.push(`tags: [${fm.tags.join(', ')}]`)
  if (fm.aliases?.length) lines.push(`aliases: [${fm.aliases.join(', ')}]`)
  if (fm.date) lines.push(`date: ${yamlScalar(fm.date)}`)
  if (fm.status) lines.push(`status: ${fm.status}`)
  if (fm.created) lines.push(`created: ${yamlScalar(fm.created)}`)
  if (fm.updated) lines.push(`updated: ${yamlScalar(fm.updated)}`)
  if (fm.author) lines.push(`author: ${yamlScalar(fm.author)}`)
  if (fm.source) {
    lines.push('source:')
    lines.push(`  importer: ${yamlScalar(fm.source.importer)}`)
    lines.push(`  original_path: ${yamlScalar(fm.source.originalPath)}`)
    lines.push(`  imported_at: ${fm.source.importedAt}`)
  }
  for (const [k, v] of Object.entries(fm.extra ?? {})) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      lines.push(`${k}:`)
      for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) lines.push(`  ${k2}: ${yamlScalar(v2)}`)
    } else {
      lines.push(`${k}: ${yamlScalar(v)}`)
    }
  }
  lines.push('---')
  return lines.join('\n')
}

export function composeDocument(fm: FrontMatter, body: string): string {
  const hasFm = Object.keys(fm.extra ?? {}).length > 0 || fm.title || fm.tags.length || fm.aliases.length || fm.id
  if (!hasFm) return body
  return `${serializeFrontMatter(fm)}\n${body.replace(/^\n+/, '')}`
}

/* ------------------------------------------------------------------ *
 * 派生信息
 * ------------------------------------------------------------------ */

export function stripFrontMatter(text: string): string {
  return parseFrontMatter(text).body
}

export function deriveTitle(text: string, path: string): string {
  const { fm, body } = parseFrontMatter(text)
  if (fm.title) return fm.title.trim()
  const h1 = body.match(/^#\s+(.+)$/m)
  if (h1) return h1[1].replace(/[#*`]/g, '').trim()
  return (path.split('/').pop() ?? '未命名').replace(/\.md$/i, '')
}

export function countWords(text: string): number {
  const body = stripFrontMatter(text)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!?\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/[#>*_`~\-|]/g, ' ')
  const cjk = body.match(/[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/g)?.length ?? 0
  const latin = body.replace(/[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/g, ' ').match(/[A-Za-z0-9]+(?:['-][A-Za-z0-9]+)*/g)?.length ?? 0
  return cjk + latin
}

export function makePreview(text: string, len = 160): string {
  const body = stripFrontMatter(text)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/[*_`>#~\-]/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
  return body.slice(0, len)
}

export function extractHeadings(text: string): Heading[] {
  const { body, bodyLineOffset } = parseFrontMatter(text)
  const lines = body.split('\n')
  const out: Heading[] = []
  let inFence = false
  let offset = 0
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence
    if (!inFence) {
      const m = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/)
      if (m) {
        out.push({
          level: m[1].length,
          text: m[2].replace(/[*_`]/g, '').replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, '$1'),
          line: i + bodyLineOffset,
          offset,
        })
      }
    }
    offset += line.length + 1
  }
  return out
}

const WIKI_RE = /\[\[([^\]\n]+?)\]\]/g

export function extractWikiLinks(text: string): WikiLink[] {
  const out: WikiLink[] = []
  const body = stripFrontMatter(text)
  let m: RegExpExecArray | null
  WIKI_RE.lastIndex = 0
  while ((m = WIKI_RE.exec(body))) {
    const raw = m[1]
    const [targetPart, alias] = raw.split('|')
    const [target, ...headingParts] = targetPart.split('#')
    if (!target.trim()) continue
    out.push({
      raw,
      target: target.trim(),
      alias: alias?.trim(),
      heading: headingParts.join('#').trim() || undefined,
      offset: m.index,
    })
  }
  return out
}

export function extractTags(text: string): string[] {
  const body = stripFrontMatter(text).replace(/```[\s\S]*?```/g, ' ')
  const set = new Set<string>()
  const re = /(^|[\s(（])#([\p{L}\p{N}_/\-]{1,64})/gu
  let m: RegExpExecArray | null
  while ((m = re.exec(body))) {
    if (m.index > 0 && body[m.index - 1] === '\n') continue
    const tag = m[2].toLowerCase()
    if (/^\d+$/.test(tag)) continue
    set.add(tag)
  }
  return [...set]
}

export function normalizeTag(tag: string): string {
  return tag.replace(/^#/, '').trim().toLowerCase()
}

export function formatTime(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  const pad = (n: number) => String(n).padStart(2, '0')
  if (sameDay) return `${pad(d.getHours())}:${pad(d.getMinutes())}`
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日`
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function statusLabel(status?: DocStatus): string {
  switch (status) {
    case 'in-progress':
      return '进行中'
    case 'done':
      return '已完成'
    case 'archived':
      return '归档'
    default:
      return '草稿'
  }
}
