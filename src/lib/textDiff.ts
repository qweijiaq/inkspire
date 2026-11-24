export interface DiffRow {
  type: 'same' | 'add' | 'del'
  text: string
}

export interface DiffStats {
  added: number
  removed: number
  unchanged: number
}

const MAX_CELLS = 3_000_000

function lcsRows(a: string[], b: string[]): DiffRow[] {
  const n = a.length
  const m = b.length
  if (n === 0) return b.map((text) => ({ type: 'add' as const, text }))
  if (m === 0) return a.map((text) => ({ type: 'del' as const, text }))
  // 超大改动不做矩阵，直接按删除+新增展示，避免卡住界面
  if (n * m > MAX_CELLS) {
    return [
      ...a.map((text) => ({ type: 'del' as const, text })),
      ...b.map((text) => ({ type: 'add' as const, text })),
    ]
  }
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const rows: DiffRow[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      rows.push({ type: 'same', text: a[i] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      rows.push({ type: 'del', text: a[i] })
      i++
    } else {
      rows.push({ type: 'add', text: b[j] })
      j++
    }
  }
  while (i < n) rows.push({ type: 'del', text: a[i++] })
  while (j < m) rows.push({ type: 'add', text: b[j++] })
  return rows
}

/** 行级 diff：先剥掉公共前后缀，只对中间变化做 LCS */
export function diffLines(before: string, after: string): DiffRow[] {
  const a = before.split('\n')
  const b = after.split('\n')
  let prefix = 0
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++
  let suffix = 0
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix++
  }
  const head = a.slice(0, prefix).map((text) => ({ type: 'same' as const, text }))
  const tail = a.slice(a.length - suffix).map((text) => ({ type: 'same' as const, text }))
  const middle = lcsRows(a.slice(prefix, a.length - suffix), b.slice(prefix, b.length - suffix))
  return [...head, ...middle, ...tail]
}

export function diffStats(rows: DiffRow[]): DiffStats {
  let added = 0
  let removed = 0
  let unchanged = 0
  for (const row of rows) {
    if (row.type === 'add') added++
    else if (row.type === 'del') removed++
    else unchanged++
  }
  return { added, removed, unchanged }
}

/** 只保留变更附近的行，避免日志弹窗里塞整篇文档 */
export function diffExcerpt(rows: DiffRow[], context = 3, maxRows = 220): DiffRow[] {
  const keep = new Set<number>()
  rows.forEach((row, i) => {
    if (row.type === 'same') return
    for (let j = Math.max(0, i - context); j <= Math.min(rows.length - 1, i + context); j++) keep.add(j)
  })
  if (!keep.size) return rows.slice(0, maxRows)
  const out: DiffRow[] = []
  let last = -1
  for (const i of [...keep].sort((x, y) => x - y)) {
    if (last >= 0 && i > last + 1) out.push({ type: 'same', text: '…' })
    out.push(rows[i])
    last = i
    if (out.length >= maxRows) break
  }
  return out
}

export type ReviewRow =
  | { type: 'same'; text: string }
  | { type: 'add'; text: string }
  | { type: 'del'; text: string }
  | { type: 'mod'; before: string; after: string; beforeParts: DiffWordChunk[]; afterParts: DiffWordChunk[] }

type DiffWordChunk = { op: 'equal' | 'add' | 'remove'; text: string }

function tokensOf(line: string): Set<string> {
  return new Set((line.toLowerCase().match(/[\u4e00-\u9fa5]|[a-z0-9]+/g) ?? []))
}

function lineSimilarity(a: string, b: string): number {
  if (!a.trim() && !b.trim()) return 1
  const sa = tokensOf(a)
  const sb = tokensOf(b)
  if (!sa.size || !sb.size) return 0
  let common = 0
  for (const token of sa) if (sb.has(token)) common++
  return common / Math.max(sa.size, sb.size)
}

function wordDiff(before: string, after: string): DiffWordChunk[] {
  // 单行通常很短；这里用字符级 LCS，避免长文整体退化成“全删全增”
  const tokenize = (text: string) => text.match(/[\u4e00-\u9fa5]|[A-Za-z0-9_]+|\s+|[^\s]/g) ?? []
  const a = tokenize(before)
  const b = tokenize(after)
  if (!a.length) return after ? [{ op: 'add', text: after }] : []
  if (!b.length) return before ? [{ op: 'remove', text: before }] : []
  if (a.length * b.length > 600_000) {
    return [
      ...(before ? [{ op: 'remove' as const, text: before }] : []),
      ...(after ? [{ op: 'add' as const, text: after }] : []),
    ]
  }
  const dp: Uint32Array[] = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1))
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const chunks: DiffWordChunk[] = []
  const push = (op: DiffWordChunk['op'], text: string) => {
    if (!text) return
    const last = chunks[chunks.length - 1]
    if (last && last.op === op) last.text += text
    else chunks.push({ op, text })
  }
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push('equal', a[i])
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      push('remove', a[i++])
    } else {
      push('add', b[j++])
    }
  }
  while (i < a.length) push('remove', a[i++])
  while (j < b.length) push('add', b[j++])
  return chunks
}

/** 行级 diff + 相似行配对 + 行内词级高亮，适合整篇润色后的审阅 */
export function diffReview(before: string, after: string, maxRows = 500): ReviewRow[] {
  const lines = diffLines(before, after)
  const out: ReviewRow[] = []
  let i = 0
  while (i < lines.length && out.length < maxRows) {
    const row = lines[i]
    if (row.type === 'same') {
      out.push({ type: 'same', text: row.text })
      i++
      continue
    }
    const dels: string[] = []
    const adds: string[] = []
    while (i < lines.length && lines[i].type !== 'same') {
      if (lines[i].type === 'del') dels.push(lines[i].text)
      else adds.push(lines[i].text)
      i++
    }
    const usedAdds = new Set<number>()
    // 大段改动按位置配对，避免长文里 O(删除行 × 新增行) 的开销
    const pairByIndex = dels.length === adds.length || dels.length * adds.length > 20_000
    for (let d = 0; d < dels.length && out.length < maxRows; d++) {
      let best = -1
      let bestScore = 0
      if (pairByIndex) {
        if (d < adds.length) {
          best = d
          bestScore = lineSimilarity(dels[d], adds[d])
        }
      } else {
        for (let a = 0; a < adds.length; a++) {
          if (usedAdds.has(a)) continue
          const score = lineSimilarity(dels[d], adds[a])
          if (score > bestScore) {
            bestScore = score
            best = a
          }
        }
      }
      if (best >= 0 && (bestScore >= 0.18 || dels.length === adds.length || pairByIndex)) {
        usedAdds.add(best)
        const parts = wordDiff(dels[d], adds[best])
        out.push({
          type: 'mod',
          before: dels[d],
          after: adds[best],
          beforeParts: parts.filter((c) => c.op !== 'add'),
          afterParts: parts.filter((c) => c.op !== 'remove'),
        })
      } else {
        out.push({ type: 'del', text: dels[d] })
      }
    }
    for (let a = 0; a < adds.length && out.length < maxRows; a++) {
      if (!usedAdds.has(a)) out.push({ type: 'add', text: adds[a] })
    }
  }
  return out
}
