interface Props {
  ok: boolean
  message: string
  output?: string
}

export default function ResultBanner({ ok, message, output }: Props) {
  return (
    <div className={`result-banner ${ok ? 'ok' : 'err'}`}>
      <span>{ok ? '✓' : '✕'}</span>
      <div className="msg">{message}</div>
      {ok && output && (
        <button className="btn btn-success" onClick={() => window.api.showItem(output)}>
          打开所在文件夹
        </button>
      )}
    </div>
  )
}
