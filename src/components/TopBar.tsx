import { vault, useVault } from '../store'
import { Momo } from './Momo'
import { formatTime } from '../lib/md'
import { ExportMenu } from './ExportMenu'
import { Icon, type IconName } from './ui/Icon'

interface Props {
  onNewDoc: () => void
  onOpenImport: () => void
  onOpenSettings: () => void
  onOpenPalette: () => void
  onToggleSidebar: () => void
  onOpenAI: () => void
  onRetrySave: () => void
}

function ToolButton({ icon, label, tip, onClick }: { icon: IconName; label: string; tip: string; onClick: () => void }) {
  return (
    <button className="tbtn" onClick={onClick} data-tip={tip} aria-label={label}>
      <Icon name={icon} size={16} />
      <span className="label">{label}</span>
    </button>
  )
}

export function TopBar({ onNewDoc, onOpenImport, onOpenSettings, onOpenPalette, onToggleSidebar, onOpenAI, onRetrySave }: Props) {
  const state = useVault()
  const doc = state.docs.find((d) => d.id === state.activeId)
  const saving = doc ? state.savingDocId === doc.id : false
  const failed = doc ? state.saveErrorDocId === doc.id : false
  const savedAt = doc ? state.savedAtByDoc[doc.id] ?? doc.updatedAt : 0
  const dark = state.settings.theme === 'night'

  return (
    <header className="topbar">
      <button className="tbtn icon ghost" onClick={onToggleSidebar} data-tip="切换侧栏（⌘B）" aria-label="切换侧栏">
        <Icon name="menu" size={18} />
      </button>
      <div className="brand">
        <Momo mood="happy" className="brand-avatar" />
        <div>
          <div className="brand-name">
            Ink<em>spire</em>
          </div>
          <span className="brand-tag">用墨点燃灵感</span>
        </div>
      </div>

      <div className="doc-title-wrap">
        <div className="doc-title">
          <span className={`dot${saving ? ' saving' : ''}${failed ? ' failed' : ''}`} />
          <span className="title">{doc?.title ?? '未打开文档'}</span>
        </div>
        {doc && (failed ? (
          <button type="button" className="save-hint failed" onClick={onRetrySave} data-tip="保存失败，点击重试">
            保存失败 · 重试
          </button>
        ) : (
          <span className="save-hint" aria-live="polite">{saving ? '保存中…' : `已保存 ${formatTime(savedAt)}`}</span>
        ))}
      </div>

      <div className="tools">
        <ToolButton icon="plus" label="新建" tip="新建文档（⌘N）" onClick={onNewDoc} />
        <ToolButton icon="download" label="导入" tip="导入文件" onClick={onOpenImport} />
        <ExportMenu />
        <button className="tbtn icon" onClick={onOpenAI} data-tip="AI 助手" aria-label="打开 AI 助手">
          <Icon name="sparkles" size={17} />
        </button>
        <button className="tbtn icon" onClick={onOpenPalette} data-tip="命令面板（⌘K）" aria-label="打开命令面板">
          <Icon name="command" size={17} />
        </button>
        <button
          className="tbtn icon"
          data-tip={dark ? '切换到纸张主题' : '切换到夜间主题'}
          aria-label={dark ? '切换到纸张主题' : '切换到夜间主题'}
          onClick={() => void vault.updateSettings({ theme: dark ? 'paper' : 'night' })}
        >
          <Icon name={dark ? 'moon' : 'sun'} size={17} />
        </button>
        <button className="tbtn icon" onClick={onOpenSettings} data-tip="设置" aria-label="打开设置">
          <Icon name="settings" size={17} />
        </button>
      </div>
    </header>
  )
}
