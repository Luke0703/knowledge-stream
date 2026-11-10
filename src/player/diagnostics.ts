// Opt-in, local console only. No URLs, identifiers, storage or network telemetry.
const enabled = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('diagnostics')
const counts: Record<string, number> = {}
export function countPlayerWork(name: string) {
  if (enabled) counts[name] = (counts[name] ?? 0) + 1
}
// Immediate, timestamped event line (same opt-in flag as the 5s summary).
// Used to compare a genuine tap, a player's ready moment, a play request
// and an autoplay block on one clock, e.g. how many ms after the start
// tap the first play request actually left the parent page.
export function diagnosticEvent(name: string, detail: Record<string, unknown>) {
  if (enabled) console.info('[player-diagnostics]', name, JSON.stringify(detail))
}
// Snapshot of the transient-activation state, where the browser exposes
// it. Round 4's hypothesis is that the YouTube iframe keeps a brief
// activation from the swipe touch even though the parent page gets none;
// logging the parent's own userActivation next to each play attempt lets
// a real-device session separate "parent had activation" from "only the
// iframe could have had it". Null where the API is unavailable.
export function userActivationSnapshot(): { isActive: boolean; hasBeenActive: boolean } | null {
  if (typeof navigator === 'undefined') return null
  const activation = (navigator as { userActivation?: { isActive: boolean; hasBeenActive: boolean } }).userActivation
  return activation ? { isActive: activation.isActive, hasBeenActive: activation.hasBeenActive } : null
}
export function startDiagnostics() {
  if (!enabled) return () => {}
  const started = performance.now()
  let longTasks = 0, longTaskMs = 0
  const observer = typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes.includes('longtask')
    ? new PerformanceObserver(list => {
      for (const entry of list.getEntries()) { longTasks++; longTaskMs += entry.duration }
    }) : null
  observer?.observe({ type: 'longtask' })
  const interval = window.setInterval(() => console.info('[player-diagnostics]', JSON.stringify({
    seconds: Math.round((performance.now() - started) / 1000), ...counts,
    iframes: document.querySelectorAll('.player-surface iframe').length,
    longTasks: observer ? longTasks : null, longTaskMs: observer ? Math.round(longTaskMs) : null,
  })), 5000)
  return () => { clearInterval(interval); observer?.disconnect() }
}
