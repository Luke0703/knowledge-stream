import { describe, expect, it, vi } from 'vitest'

// The diagnostics module reads ?diagnostics=1 from the URL once, at
// import time, and gates every event on it (inert in the other test
// files). Enable the flag and import fresh copies of the modules so
// these tests observe the real session ring buffer — the same one the
// on-screen diagnostics panel reads on device — instead of inferring
// the settleCommit event from player mock calls alone.
const loadModules = async () => {
  window.history.replaceState(null, '', '/?diagnostics=1')
  vi.resetModules()
  const coordinatorModule = await import('../src/player/PlaybackCoordinator')
  const diagnosticsModule = await import('../src/player/diagnostics')
  return { PlaybackCoordinator: coordinatorModule.PlaybackCoordinator, diagnostics: diagnosticsModule }
}

const player = () => ({ pauseVideo: vi.fn(), mute: vi.fn(), unMute: vi.fn(), playVideo: vi.fn(), seekTo: vi.fn() })

describe('settle commit diagnostics (round 8)', () => {
  it('emits settleCommit and a settle-commit play request for an already-active blocked target', async () => {
    const { PlaybackCoordinator, diagnostics } = await loadModules()
    const coordinator = new PlaybackCoordinator(), first = player(), next = player()
    coordinator.register(0, first); coordinator.register(1, next)
    coordinator.setActive(0)
    diagnostics.clearDiagnosticLog()
    // The 2026-11-14 device sequence: early attempt blocked, then the
    // measure activates the card mid-scroll and the reconcile start is
    // blocked too, leaving the target active in blockedByAutoplay.
    coordinator.noteScrollStarted()
    coordinator.attemptEarlyStart(1)
    coordinator.onAutoplayBlocked(1)
    coordinator.setActive(1)
    coordinator.onAutoplayBlocked(1)
    next.playVideo.mockClear()
    coordinator.commitSettleTarget(1)
    expect(next.playVideo).toHaveBeenCalledOnce()
    const snapshot = diagnostics.getDiagnosticLogSnapshot()
    expect(snapshot.filter(entry => entry.name === 'settleCommit')).toHaveLength(1)
    const settleRequest = snapshot.find(entry => entry.name === 'playRequest' && entry.detail.includes('"reason":"settle-commit"'))
    expect(settleRequest).toBeTruthy()
    coordinator.commitSettleTarget(1) // Same episode: no second commit, no second diagnostic.
    expect(diagnostics.getDiagnosticLogSnapshot().filter(entry => entry.name === 'settleCommit')).toHaveLength(1)
  })

  it('records pointerGate switches and gestureEnd arrivals in the ring buffer (round 9)', async () => {
    const { PlaybackCoordinator, diagnostics } = await loadModules()
    const coordinator = new PlaybackCoordinator(), first = player(), next = player()
    coordinator.register(0, first); coordinator.register(1, next)
    coordinator.setActive(0)
    diagnostics.clearDiagnosticLog()
    coordinator.onStateChange(0, first, 1) // Settled + playing: the gate opens for card 1 only.
    coordinator.noteScrollStarted() // The next scroll closes it again.
    let snapshot = diagnostics.getDiagnosticLogSnapshot()
    const gateEvents = snapshot.filter(entry => entry.name === 'pointerGate')
    expect(gateEvents).toHaveLength(2)
    expect(gateEvents[0].detail).toContain('"index":0')
    expect(gateEvents[0].detail).toContain('"interactive":true')
    expect(gateEvents[1].detail).toContain('"interactive":false')
    expect(gateEvents[1].detail).toContain('"reason":"scroll-start"')
    expect(coordinator.isIframeInteractive(0)).toBe(false)
    // Every gesture-end event the parent receives is logged before
    // dedupe, with the activation the parent held at that moment — the
    // evidence rounds 6–8 could not produce on device.
    diagnostics.clearDiagnosticLog()
    coordinator.noteGestureEnd('touchend', { episodeActive: true, alreadyHandled: false })
    coordinator.noteGestureEnd('pointercancel', { episodeActive: false, alreadyHandled: false })
    snapshot = diagnostics.getDiagnosticLogSnapshot()
    const endEvents = snapshot.filter(entry => entry.name === 'gestureEnd')
    expect(endEvents).toHaveLength(2)
    expect(endEvents[0].detail).toContain('"type":"touchend"')
    expect(endEvents[0].detail).toContain('"userActivation"')
    expect(endEvents[1].detail).toContain('"type":"pointercancel"')
  })

  it('emits no settleCommit when the active target is not blocked', async () => {
    const { PlaybackCoordinator, diagnostics } = await loadModules()
    const coordinator = new PlaybackCoordinator(), first = player(), next = player()
    coordinator.register(0, first); coordinator.register(1, next)
    coordinator.setActive(0)
    coordinator.noteScrollStarted()
    coordinator.setActive(1) // Reconcile start issued and not blocked: nothing to commit.
    diagnostics.clearDiagnosticLog()
    next.playVideo.mockClear()
    coordinator.commitSettleTarget(1)
    expect(next.playVideo).not.toHaveBeenCalled()
    expect(diagnostics.getDiagnosticLogSnapshot().filter(entry => entry.name === 'settleCommit')).toHaveLength(0)
  })
})
