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
