import { useRef } from 'react'
import { createPortal } from 'react-dom'
import { dueCards, staleCards, type LearningState } from '../lib/learning'
import { readingAgo, type ReadingSpot } from '../lib/reading'
import { Momo } from './Momo'
import { Icon } from './ui/Icon'
import { useDialogA11y } from './ui/useDialogA11y'

export function GrowthReport({ learning, reading, onClose }: { learning: LearningState; reading: ReadingSpot[]; onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement | null>(null)
  useDialogA11y(dialogRef, onClose)
  const weekCards = learning.cards.filter((c) => Date.now() - c.createdAt < 7 * 86_400_000).length
  const due = dueCards(learning.cards).length
  const stale = staleCards(learning.cards).length
  const seconds = reading.reduce((n, r) => n + (r.seconds ?? 0), 0)
  const minutes = Math.round(seconds / 60)
  const latest = reading[0]

  return createPortal(
    <div className="report-mask" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="report-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-label="共学周报">
        <div className="report-head">
          <Momo mood="happy" className="momo-mini" />
          <div>
            <b>墨墨的共学周报</b>
            <span>只统计你主动读、记、复习的内容</span>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭"><Icon name="close" size={16} /></button>
        </div>

        <p className="report-lede">
          这周我陪你新增了 <b>{weekCards}</b> 张卡片，复习了 <b>{learning.reviews}</b> 次；你已经连续学习 <b>{learning.streak}</b> 天。
          {latest ? ` 最近一次读到「${latest.section ?? `第 ${latest.line} 行`}」，是 ${readingAgo(latest.at)}。` : ' 还没有阅读记录，打开一篇文档我们就开始。'}
        </p>

        <div className="report-stats">
          <div><b>{minutes}</b><span>累计阅读分钟</span></div>
          <div><b>{learning.cards.length}</b><span>卡片总数</span></div>
          <div><b>{due}</b><span>待复习</span></div>
          <div><b>{stale}</b><span>遗忘预警</span></div>
        </div>

        <div className="report-note">
          {stale > 0
            ? `有 ${stale} 张卡超过 14 天没复习了，建议今天先处理它们。`
            : due > 0
              ? `今天有 ${due} 张卡到期，做完再休息。`
              : '今天的复习清空了，去读点新东西吧。'}
        </div>

        <div className="report-actions">
          <button className="tbtn primary" type="button" onClick={onClose}>知道了</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
