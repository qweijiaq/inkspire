import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { reviewCard, type LearningCard } from '../lib/learning'
import { Momo } from './Momo'
import { Icon } from './ui/Icon'
import { useDialogA11y } from './ui/useDialogA11y'

interface Props {
  cards: LearningCard[]
  onClose: () => void
}

export function QuizModal({ cards, onClose }: Props) {
  // 打开小测时冻结题目；答一题会触发 learning 事件并刷新 cards，不能跟着重新抽题。
  const [picked] = useState(() => [...cards].sort(() => Math.random() - 0.5).slice(0, Math.min(3, cards.length)))
  const [index, setIndex] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [correct, setCorrect] = useState(0)
  const dialogRef = useRef<HTMLDivElement | null>(null)
  useDialogA11y(dialogRef, onClose, picked.length > 0)

  if (!picked.length) return null
  const card = picked[index]
  const done = index >= picked.length

  return createPortal(
    <div className="quiz-mask" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="quiz-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-label="墨墨小测">
        <div className="quiz-head">
          <Momo mood={done ? 'happy' : 'thinking'} className="momo-mini" />
          <div>
            <b>{done ? '小测完成' : `考考我 · ${index + 1}/${picked.length}`}</b>
            <span>{done ? '答错也没关系，卡片会很快回来' : '先自己想一想，再显示答案'}</span>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭"><Icon name="close" size={16} /></button>
        </div>

        {done ? (
          <div className="quiz-result">
            <b>{correct} / {picked.length}</b>
            <span>答对</span>
            <div className="quiz-actions">
              <button className="tbtn primary" type="button" onClick={onClose}>回到共学</button>
            </div>
          </div>
        ) : (
          <>
            <div className="quiz-question">{card.question}</div>
            {revealed ? (
              <div className="quiz-answer">{card.answer}</div>
            ) : (
              <div className="quiz-placeholder">答案先藏起来。</div>
            )}
            <div className="quiz-actions">
              {!revealed ? (
                <button className="tbtn primary" type="button" onClick={() => setRevealed(true)}>显示答案</button>
              ) : (
                <>
                  <button
                    className="tbtn"
                    type="button"
                    onClick={() => {
                      reviewCard(card.id, false)
                      setRevealed(false)
                      setIndex((i) => i + 1)
                    }}
                  >
                    忘了
                  </button>
                  <button
                    className="tbtn primary"
                    type="button"
                    onClick={() => {
                      reviewCard(card.id, true)
                      setCorrect((n) => n + 1)
                      setRevealed(false)
                      setIndex((i) => i + 1)
                    }}
                  >
                    记得
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}
