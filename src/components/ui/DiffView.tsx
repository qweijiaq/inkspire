import { useMemo } from 'react'
import { diffReview, type ReviewRow } from '../../lib/textDiff'

interface Props {
  before: string
  after: string
  className?: string
  maxRows?: number
}

/** 审阅用 diff：相同行降噪，改动行配对并做行内词级高亮 */
export function DiffView({ before, after, className = '', maxRows = 500 }: Props) {
  const rows: ReviewRow[] = useMemo(() => diffReview(before, after, maxRows), [before, after, maxRows])
  return (
    <pre className={`diff-view ${className}`.trim()} aria-label="逐行 diff">
      {rows.map((row: ReviewRow, i: number) => {
        if (row.type === 'same') {
          return (
            <span key={i} className="diff-same">
              {'  '}
              {row.text || ' '}
              {'\n'}
            </span>
          )
        }
        if (row.type === 'del') {
          return (
            <span key={i} className="diff-del">
              {'- '}
              {row.text || ' '}
              {'\n'}
            </span>
          )
        }
        if (row.type === 'add') {
          return (
            <span key={i} className="diff-add">
              {'+ '}
              {row.text || ' '}
              {'\n'}
            </span>
          )
        }
        return (
          <span key={i} className="diff-mod">
            <span className="diff-del">
              {'- '}
              {row.beforeParts?.map((chunk, j) =>
                chunk.op === 'remove' ? <del key={j}>{chunk.text}</del> : <span key={j}>{chunk.text}</span>,
              )}
              {'\n'}
            </span>
            <span className="diff-add">
              {'+ '}
              {row.afterParts?.map((chunk, j) =>
                chunk.op === 'add' ? <ins key={j}>{chunk.text}</ins> : <span key={j}>{chunk.text}</span>,
              )}
              {'\n'}
            </span>
          </span>
        )
      })}
    </pre>
  )
}
