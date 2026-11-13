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
  if (!enabled) return
  const text = JSON.stringify(detail)
  console.info('[player-diagnostics]', name, text)
  diagnosticLog.append(name, text)
}

// One buffered diagnostic event, kept in memory only (never persisted or
// sent anywhere) so a ?diagnostics=1 session can show recent events on
// screen — an iPhone without a Mac has no console to read.
export interface DiagnosticLogEntry {
  seq: number
  name: string
  detail: string
  elapsedMs: number
}
export interface DiagnosticLog {
  append(name: string, detail: string): void
  clear(): void
  getSnapshot(): readonly DiagnosticLogEntry[]
  subscribe(listener: () => void): () => void
}
const DIAGNOSTIC_LOG_CAP = 60
export function createDiagnosticLog(cap = DIAGNOSTIC_LOG_CAP): DiagnosticLog {
  const epoch = typeof performance !== 'undefined' ? performance.now() : 0
  let entries: readonly DiagnosticLogEntry[] = []
  let seq = 0
  const listeners = new Set<() => void>()
  const notify = () => { for (const listener of [...listeners]) listener() }
  return {
    append(name, detail) {
      const now = typeof performance !== 'undefined' ? performance.now() : 0
      const entry: DiagnosticLogEntry = { seq: ++seq, name, detail, elapsedMs: Math.max(0, Math.round(now - epoch)) }
      // Replace (never mutate) the array so useSyncExternalStore snapshots
      // stay referentially stable between changes.
      entries = [...entries, entry].slice(-cap)
      notify()
    },
    clear() {
      if (entries.length === 0) return
      entries = []
      notify()
    },
    getSnapshot: () => entries,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}
// Session-wide log fed by diagnosticEvent; inert unless the flag is on,
// because diagnosticEvent is its only writer.
export const diagnosticLog = createDiagnosticLog()
export const isDiagnosticsEnabled = enabled
export function getDiagnosticLogSnapshot(): readonly DiagnosticLogEntry[] {
  return diagnosticLog.getSnapshot()
}
export function subscribeDiagnosticLog(listener: () => void): () => void {
  return diagnosticLog.subscribe(listener)
}
export function clearDiagnosticLog() {
  diagnosticLog.clear()
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
