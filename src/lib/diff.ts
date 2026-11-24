export type DiffOp = 'equal' | 'add' | 'remove'
export interface DiffChunk {
  op: DiffOp
  text: string
}

/** 轻量词级 diff：中文按字、英文按词，避免引入额外依赖；超长文本退化为整段替换。 */
export function diffWords(before: string, after: string): DiffChunk[] {
  const tokenize = (text: string) => text.match(/[\u4e00-\u9fa5]|[A-Za-z0-9_]+|\s+|[^\s]/g) ?? []
  const a = tokenize(before)
  const b = tokenize(after)
  if (a.length > 1200 || b.length > 1200) {
    return [
      ...(before ? [{ op: 'remove' as const, text: before }] : []),
      ...(after ? [{ op: 'add' as const, text: after }] : []),
    ]
  }
  const n = a.length
  const m = b.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const chunks: DiffChunk[] = []
  const push = (op: DiffOp, text: string) => {
    if (!text) return
    const last = chunks[chunks.length - 1]
    if (last && last.op === op) last.text += text
    else chunks.push({ op, text })
  }
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push('equal', a[i])
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      push('remove', a[i])
      i++
    } else {
      push('add', b[j])
      j++
    }
  }
  while (i < n) push('remove', a[i++])
  while (j < m) push('add', b[j++])
  return chunks
}
