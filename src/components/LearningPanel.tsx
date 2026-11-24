import { useMemo, useState } from 'react'
import { dueCards, removeCard, reviewCard, staleCards, useLearning, type LearningCard } from '../lib/learning'
import { readingAgo, useReading } from '../lib/reading'
import { Momo } from './Momo'
import { QuizModal } from './QuizModal'
import { GrowthReport } from './GrowthReport'
import { Icon } from './ui/Icon'

function dueLabel(card: LearningCard) {
  const days = Math.ceil((card.due - Date.now()) / 86_400_000)
  if (days <= 0) return '今天'
  if (days === 1) return '明天'
  return `${days} 天后`
}

export function LearningPanel({ onOpenDoc }: { onOpenDoc: (id: string, line?: number) => void }) {
  const state = useLearning()
  const reading = useReading()
  const due = useMemo(() => dueCards(state.cards), [state.cards])
  const weekCards = useMemo(() => state.cards.filter((c) => Date.now() - c.createdAt < 7 * 86_400_000).length, [state.cards])
  const stale = useMemo(() => staleCards(state.cards), [state.cards])
  const [revealed, setRevealed] = useState<Set<string>>(new Set())
  const [tab, setTab] = useState<'due' | 'all'>('due')
  const [quiz, setQuiz] = useState(false)
  const [report, setReport] = useState(false)
  const badges = [
    { id: 'first', label: '第一张卡', earned: state.cards.length >= 1 },
    { id: 'ten', label: '十张卡', earned: state.cards.length >= 10 },
    { id: 'week', label: '连续 7 天', earned: state.streak >= 7 },
    { id: 'review25', label: '复习 25 次', earned: state.reviews >= 25 },
    { id: 'review100', label: '复习 100 次', earned: state.reviews >= 100 },
  ]

  const reveal = (id: string) => setRevealed((prev) => new Set(prev).add(id))

  return (
    <div className="learning-panel">
      <div className="learning-panel-head">
        <Momo mood="thinking" className="momo-mini" />
        <div>
          <b>共学</b>
          <span>墨墨帮你把读过的内容留久一点</span>
        </div>
      </div>

      <div className="learning-stats">
        <div><b>{state.streak}</b><span>连续学习天数</span></div>
        <div><b>{due.length}</b><span>待复习</span></div>
        <div><b>{state.cards.length}</b><span>卡片总数</span></div>
      </div>

      <div className="learning-week">本周新增 {weekCards} 张 · 累计复习 {state.reviews} 次</div>

      <div className="learning-report-row">
        <button type="button" onClick={() => setReport(true)}>本周报告</button>
        {stale.length > 0 && <span>有 {stale.length} 张卡超过 14 天没复习</span>}
      </div>

      <div className="learning-badges">
        {badges.map((b) => (
          <span key={b.id} className={b.earned ? 'on' : ''}><Icon name={b.earned ? 'check' : 'circle'} size={11} /> {b.label}</span>
        ))}
      </div>

      {reading.length > 0 && (
        <div className="learning-recent">
          <div className="learning-recent-title">最近阅读</div>
          {reading.slice(0, 3).map((r) => (
            <button key={r.docId} type="button" onClick={() => onOpenDoc(r.docId, Math.max(0, r.line - 1))}>
              <b>{r.title}</b>
              <span>{r.section ? `${r.section} · ` : `第 ${r.line} 行 · `}{readingAgo(r.at)}</span>
            </button>
          ))}
        </div>
      )}

      <div className="learning-tabs">
        <button type="button" className={tab === 'due' ? 'on' : ''} onClick={() => setTab('due')}>待复习 {due.length}</button>
        <button type="button" className={tab === 'all' ? 'on' : ''} onClick={() => setTab('all')}>全部 {state.cards.length}</button>
        <button type="button" onClick={() => setQuiz(true)} disabled={!state.cards.length}>考考我</button>
      </div>

      {quiz && <QuizModal cards={state.cards} onClose={() => setQuiz(false)} />}
      {report && <GrowthReport learning={state} reading={reading} onClose={() => setReport(false)} />}

      {tab === 'due' && (
        <div className="learning-list">
          {!due.length && <div className="learning-empty">今天没有到期卡片。选中文字点「记住」，墨墨会帮你做一张卡。</div>}
          {due.map((card) => (
            <div className="learning-card" key={card.id}>
              <div className="learning-card-meta">{card.docTitle}<span>复习 {card.reviews} 次</span></div>
              <b className="learning-question">{card.question}</b>
              {revealed.has(card.id) ? (
                <>
                  <p className="learning-answer">{card.answer}</p>
                  <div className="learning-card-actions">
                    <button type="button" className="tbtn" onClick={() => reviewCard(card.id, false)}>忘了</button>
                    <button type="button" className="tbtn primary" onClick={() => reviewCard(card.id, true)}>记得</button>
                  </div>
                </>
              ) : (
                <div className="learning-card-actions">
                  <button type="button" className="tbtn" onClick={() => onOpenDoc(card.docId)}>看原文</button>
                  <button type="button" className="tbtn primary" onClick={() => reveal(card.id)}>显示答案</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === 'all' && (
        <div className="learning-list">
          {!state.cards.length && <div className="learning-empty">还没有卡片。</div>}
          {state.cards.map((card) => (
            <div className="learning-card" key={card.id}>
              <div className="learning-card-meta">{card.docTitle}<span>{dueLabel(card)}</span></div>
              <b className="learning-question">{card.question}</b>
              <p className="learning-answer muted">{card.answer}</p>
              <div className="learning-card-actions">
                <button type="button" className="tbtn" onClick={() => onOpenDoc(card.docId)}>看原文</button>
                <button type="button" className="tbtn" onClick={() => removeCard(card.id)}>删除</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
