import { useEffect, useState } from 'react'
import { formatPreciseTime, parseTime } from '../utils/format'

interface Props {
  value: number
  max: number
  onCommit: (v: number) => void
  disabled?: boolean
}

/** 精确时间输入框（HH:MM:SS.mmm），回车或失焦提交，非法输入回滚。 */
export default function TimeInput({ value, max, onCommit, disabled }: Props) {
  const [text, setText] = useState(formatPreciseTime(value))
  const [focused, setFocused] = useState(false)
  const parsed = parseTime(text)
  const invalid = Number.isNaN(parsed) || parsed < 0 || (max > 0 && parsed > max + 0.001)

  useEffect(() => { if (!focused) setText(formatPreciseTime(value)) }, [value, focused])

  const commit = () => {
    if (!invalid) onCommit(parsed)
    else setText(formatPreciseTime(value))
  }

  return (
    <input
      type="text"
      className={`time-input ${invalid ? 'invalid' : ''}`}
      value={text}
      disabled={disabled}
      spellCheck={false}
      onFocus={() => setFocused(true)}
      onBlur={() => { setFocused(false); commit() }}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { commit(); (e.target as HTMLInputElement).blur() }
        if (e.key === 'Escape') { setText(formatPreciseTime(value)); (e.target as HTMLInputElement).blur() }
      }}
    />
  )
}
