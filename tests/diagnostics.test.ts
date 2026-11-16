import { describe, expect, it, vi } from 'vitest'
import { createDiagnosticLog } from '../src/player/diagnostics'

describe('diagnostic event ring buffer', () => {
  it('appends entries with sequence numbers, detail text and elapsed ms', () => {
    const log = createDiagnosticLog()
    log.append('swipeCommit', '{"index":1}')
    log.append('playRequest', '{"index":1,"reason":"touchend-commit"}')
    const snapshot = log.getSnapshot()
    expect(snapshot).toHaveLength(2)
    expect(snapshot[0]).toMatchObject({ seq: 1, name: 'swipeCommit', detail: '{"index":1}' })
    expect(snapshot[1]).toMatchObject({ seq: 2, name: 'playRequest' })
    expect(snapshot[0]!.elapsedMs).toBeGreaterThanOrEqual(0)
    expect(snapshot[1]!.elapsedMs).toBeGreaterThanOrEqual(snapshot[0]!.elapsedMs)
  })

  it('caps the buffer at the configured size, dropping the oldest events', () => {
    const log = createDiagnosticLog(3)
    for (let i = 1; i <= 5; i++) log.append(`event-${i}`, '{}')
    const snapshot = log.getSnapshot()
    expect(snapshot.map(entry => entry.name)).toEqual(['event-3', 'event-4', 'event-5'])
    expect(snapshot.map(entry => entry.seq)).toEqual([3, 4, 5])
  })

  it('keeps the default cap at 60 events', () => {
    const log = createDiagnosticLog()
    for (let i = 0; i < 75; i++) log.append('tick', '{}')
    expect(log.getSnapshot()).toHaveLength(60)
    expect(log.getSnapshot()[0]?.seq).toBe(16)
  })

  it('returns a referentially stable snapshot until the next change', () => {
    const log = createDiagnosticLog()
    const empty = log.getSnapshot()
    expect(log.getSnapshot()).toBe(empty)
    log.append('ready', '{}')
    const afterAppend = log.getSnapshot()
    expect(afterAppend).not.toBe(empty)
    expect(log.getSnapshot()).toBe(afterAppend)
  })

  it('notifies subscribers on append and clear, and stops after unsubscribe', () => {
    const log = createDiagnosticLog()
    const listener = vi.fn()
    const unsubscribe = log.subscribe(listener)
    log.append('ready', '{}')
    expect(listener).toHaveBeenCalledTimes(1)
    log.clear()
    expect(listener).toHaveBeenCalledTimes(2)
    expect(log.getSnapshot()).toEqual([])
    unsubscribe()
    log.append('again', '{}')
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('clearing an already empty buffer does not notify', () => {
    const log = createDiagnosticLog()
    const listener = vi.fn()
    log.subscribe(listener)
    log.clear()
    expect(listener).not.toHaveBeenCalled()
  })
})
