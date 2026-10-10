interface Option<T extends string> { id: T; label: string; desc?: string }

export default function PresetGroup<T extends string>({ options, value, onChange, disabled }: {
  options: readonly Option<T>[]
  value: T
  onChange: (v: T) => void
  disabled?: boolean
}) {
  return (
    <div className="preset-group">
      {options.map((p) => (
        <button
          key={p.id}
          className={`preset-btn ${value === p.id ? 'active' : ''}`}
          onClick={() => onChange(p.id)}
          disabled={disabled}
          title={p.desc}
        >
          {p.label}
        </button>
      ))}
    </div>
  )
}
