import { Icon } from './Icon'

interface Props {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: string
  ariaLabel?: string
}

export function Checkbox({ checked, onChange, label, ariaLabel }: Props) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={ariaLabel ?? label}
      className={`ui-checkbox${checked ? ' checked' : ''}`}
      onClick={(e) => {
        e.stopPropagation()
        onChange(!checked)
      }}
    >
      <span className="ui-checkbox-box">{checked ? <Icon name="check" size={11} strokeWidth={2.5} /> : ''}</span>
      {label && <span className="ui-checkbox-label">{label}</span>}
    </button>
  )
}
