import type { Mood } from '../types'

const INK = 'var(--ink)'
const BODY = 'var(--mm-body)'
const BODY2 = 'var(--mm-body-2)'
const BELLY = 'var(--mm-belly)'

function eye(type: string, side: 'l' | 'r'): string {
  const cx = side === 'l' ? 51 : 89
  switch (type) {
    case 'happy':
      return `<path d="M${cx - 10} 78 Q${cx} 64 ${cx + 10} 78" fill="none" stroke="${INK}" stroke-width="3.4" stroke-linecap="round"/>`
    case 'focus':
      return `<path d="M${cx - 9} 76 Q${cx} 69 ${cx + 9} 76" fill="none" stroke="${INK}" stroke-width="3.2" stroke-linecap="round"/><path d="M${cx - 8} 66 Q${cx} 62 ${cx + 8} 65" fill="none" stroke="${INK}" stroke-width="2" stroke-linecap="round"/>`
    case 'sleep':
      return `<path d="M${cx - 9} 76 Q${cx} 84 ${cx + 9} 76" fill="none" stroke="${INK}" stroke-width="3.2" stroke-linecap="round"/>`
    case 'surprise':
      return `<ellipse cx="${cx}" cy="76" rx="9" ry="11" fill="var(--mm-eye)" stroke="${INK}" stroke-width="2.5"/><circle cx="${cx}" cy="77" r="4" fill="${INK}"/><circle cx="${cx + 2}" cy="73" r="1.8" fill="var(--mm-eye)"/>`
    default:
      return `<g class="mm-eye"><ellipse cx="${cx}" cy="76" rx="10" ry="12" fill="var(--mm-eye)" stroke="${INK}" stroke-width="2.5"/><ellipse cx="${cx + 1}" cy="79" rx="5.6" ry="6.6" fill="${INK}"/><circle cx="${cx + 3}" cy="74" r="2.3" fill="var(--mm-eye)"/><circle cx="${cx - 1.5}" cy="82" r="1.1" fill="var(--mm-eye)"/></g>`
  }
}

function mouth(type: string): string {
  switch (type) {
    case 'laugh':
      return `<path d="M61 96 Q70 112 79 96 Z" fill="var(--mm-mouth)" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/><path d="M66 104 Q70 109 74 104" fill="var(--mm-tongue)"/>`
    case 'flat':
      return `<path d="M65 99 Q70 101 75 99" fill="none" stroke="${INK}" stroke-width="2.6" stroke-linecap="round"/>`
    case 'o':
      return `<ellipse cx="70" cy="100" rx="4" ry="5.5" fill="var(--mm-mouth)" stroke="${INK}" stroke-width="2.2"/>`
    default:
      return `<path d="M62 97 Q66 103 70 98 Q74 103 78 97" fill="none" stroke="${INK}" stroke-width="2.6" stroke-linecap="round"/>`
  }
}

export function momoSVG(mood: Mood = 'idle'): string {
  let le = 'open'
  let re = 'open'
  let mo = 'smile'
  if (mood === 'happy') {
    le = 'happy'
    re = 'happy'
    mo = 'laugh'
  } else if (mood === 'writing') {
    le = 'focus'
    re = 'focus'
    mo = 'o'
  } else if (mood === 'thinking') {
    le = 'focus'
    re = 'open'
    mo = 'o'
  } else if (mood === 'surprised') {
    le = 'surprise'
    re = 'surprise'
    mo = 'o'
  } else if (mood === 'sleepy') {
    le = 'sleep'
    re = 'sleep'
    mo = 'flat'
  }
  const blush = mood === 'happy' || mood === 'surprised' ? 0.95 : 0.6
  return `<svg viewBox="0 0 140 140" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%;display:block">
    <g class="mm-bob">
      <g class="mm-body-g">
        <path d="M103 104 C132 106 136 78 123 67" fill="none" stroke="${INK}" stroke-width="14" stroke-linecap="round"/>
        <path d="M103 104 C132 106 136 78 123 67" fill="none" stroke="${BODY}" stroke-width="9" stroke-linecap="round"/>
        <path d="M42 44 L34 20 L58 34 Z" fill="${BODY}" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
        <path d="M98 44 L106 20 L82 34 Z" fill="${BODY}" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
        <path d="M43 40 L38 27 L51 35 Z" fill="var(--mm-tongue)"/>
        <path d="M97 40 L102 27 L89 35 Z" fill="var(--mm-tongue)"/>
        <ellipse cx="70" cy="82" rx="43" ry="39" fill="${BODY}" stroke="${INK}" stroke-width="3"/>
        <ellipse cx="70" cy="94" rx="27" ry="21" fill="${BELLY}" opacity=".55"/>
        <circle cx="34" cy="96" r="9" fill="${BODY2}" stroke="${INK}" stroke-width="2.5"/>
        <circle cx="106" cy="96" r="9" fill="${BODY2}" stroke="${INK}" stroke-width="2.5"/>
        <ellipse cx="42" cy="91" rx="7" ry="4.5" fill="var(--mm-blush)" opacity="${blush}"/>
        <ellipse cx="98" cy="91" rx="7" ry="4.5" fill="var(--mm-blush)" opacity="${blush}"/>
        ${eye(le, 'l')}${eye(re, 'r')}
        ${mouth(mo)}
        <rect x="67" y="16" width="6" height="20" rx="3" fill="var(--mm-mouth)" stroke="${INK}" stroke-width="2" class="mm-cursor"/>
        <circle cx="44" cy="63" r="2.4" fill="var(--mm-eye)" opacity=".55"/>
        <circle cx="96" cy="60" r="1.8" fill="var(--mm-eye)" opacity=".5"/>
        <g class="mm-think"><circle cx="112" cy="30" r="4" fill="var(--mm-eye)" stroke="${INK}" stroke-width="2"/><circle class="think-dot" cx="122" cy="20" r="2.6" fill="var(--mm-eye)" stroke="${INK}" stroke-width="1.6"/><circle class="think-dot" cx="130" cy="12" r="1.6" fill="var(--mm-eye)" stroke="${INK}" stroke-width="1.2"/></g>
      </g>
    </g>
  </svg>`
}

export function Momo({ mood = 'idle', className = '', title }: { mood?: Mood; className?: string; title?: string }) {
  return <span className={className} data-tip={title} data-mood={mood} aria-hidden={title ? undefined : 'true'} dangerouslySetInnerHTML={{ __html: momoSVG(mood) }} />
}

export const PET_LINES: Record<string, { line: string; mood: Mood }[]> = {
  idle: [
    { line: '嗨！我是墨墨~', mood: 'idle' },
    { line: '今天也一起写点什么吧', mood: 'happy' },
    { line: '（打了个哈欠）', mood: 'sleepy' },
    { line: '要不要试试 ⌘K？', mood: 'thinking' },
  ],
  writing: [
    { line: '认真写…我不打扰你', mood: 'writing' },
    { line: '唰唰唰~', mood: 'writing' },
    { line: '这个想法不错！', mood: 'happy' },
  ],
  thinking: [
    { line: '让我想想…', mood: 'thinking' },
    { line: '嗯…这里有种联系', mood: 'thinking' },
  ],
  surprised: [{ line: '诶？！', mood: 'surprised' }],
  sleepy: [
    { line: '困了…先歇会儿', mood: 'sleepy' },
    { line: 'Zzz…', mood: 'sleepy' },
  ],
}
