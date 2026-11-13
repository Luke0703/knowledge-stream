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
