import { useState, useSyncExternalStore } from 'react'
import { clearDiagnosticLog, getDiagnosticLogSnapshot, subscribeDiagnosticLog } from './diagnostics'

// On-screen diagnostics for ?diagnostics=1 sessions. An iPhone without a
// Mac cannot read console.info, so the buffered diagnosticEvent lines are
// also rendered here. This strip lives in the app layout BELOW the feed
// host and ABOVE the bottom navigation — outside every player surface —
// and it is not an overlay: the grid gives it its own row, so it never
// covers the YouTube player or intercepts feed touches outside its box.
export function DiagnosticsPanel() {
  const entries = useSyncExternalStore(subscribeDiagnosticLog, getDiagnosticLogSnapshot)
  const [open, setOpen] = useState(true)
  // Newest first: after a swipe the latest events (e.g. swipeCommit) are
  // what a device check needs to see; seq numbers keep the order explicit.
  const newestFirst = [...entries].reverse()
  return <section className="diagnostics-panel" data-testid="diagnostics-panel" aria-label="プレーヤー診断ログ">
    <div className="diagnostics-panel__head">
      <span>診断ログ（新しい順） {entries.length}件</span>
      <span className="diagnostics-panel__actions">
        <button type="button" onClick={() => setOpen(value => !value)}>{open ? '閉じる' : '開く'}</button>
        <button type="button" onClick={clearDiagnosticLog}>クリア</button>
      </span>
    </div>
    {open && (newestFirst.length === 0
      ? <p className="diagnostics-panel__empty">まだイベントがありません。再生やスワイプをすると記録されます。</p>
      : <ol>
        {newestFirst.map(entry => <li key={entry.seq}>#{entry.seq} +{entry.elapsedMs}ms {entry.name} {entry.detail}</li>)}
      </ol>)}
  </section>
}
