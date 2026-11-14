import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SinglePlaybackCoordinator } from '../src/player/SinglePlaybackCoordinator'
import type { SinglePlayerControl } from '../src/player/SinglePlaybackCoordinator'
import { testVideos } from '../src/videos'

// Round 10: the single-persistent-player core. The fake control stands
// in for the one YT.Player; loadVideoById is the switch, playVideo the
// restart of the already-loaded video.
const fakeControl = () => ({
  pauseVideo: vi.fn(), playVideo: vi.fn(), mute: vi.fn(), unMute: vi.fn(),
  seekTo: vi.fn(), loadVideoById: vi.fn(), cueVideoById: vi.fn(),
})

let now = 1_000
beforeEach(() => {
  now = 1_000
  vi.spyOn(performance, 'now').mockImplementation(() => now)
})
afterEach(() => { vi.restoreAllMocks() })

const setup = () => {
  const coordinator = new SinglePlaybackCoordinator()
  coordinator.setVideos(testVideos)
  const player = fakeControl()
  coordinator.registerPlayer(player as unknown as SinglePlayerControl, 0)
  return { coordinator, player }
}

describe('single-player blessing and switching', () => {
  it('blesses the one player from the start tap and starts the loaded video', () => {
    const { coordinator, player } = setup()
    coordinator.startFromGesture(0)
    expect(player.unMute).toHaveBeenCalledOnce()
    expect(player.playVideo).toHaveBeenCalledOnce()
    expect(player.loadVideoById).not.toHaveBeenCalled()
    expect(coordinator.getDisplayIndex()).toBe(0)
    expect(coordinator.isReady(0)).toBe(true)
  })

  it('never starts while held; the start tap fires the armed start', () => {
    const coordinator = new SinglePlaybackCoordinator()
    coordinator.setVideos(testVideos)
    coordinator.setHeld(true)
    const player = fakeControl()
    coordinator.registerPlayer(player as unknown as SinglePlayerControl, 0)
    expect(player.pauseVideo).toHaveBeenCalled()
    coordinator.setActive(0)
    coordinator.commitSwipeTarget(1) // Held: commits are inert too.
    expect(player.playVideo).not.toHaveBeenCalled()
    expect(player.loadVideoById).not.toHaveBeenCalled()
    coordinator.startFromGesture(0)
    expect(player.playVideo).toHaveBeenCalledOnce()
  })

  it('switches via loadVideoById synchronously inside the gesture-end commit', () => {
    const { coordinator, player } = setup()
    coordinator.startFromGesture(0)
    player.unMute.mockClear(); player.playVideo.mockClear()
    coordinator.noteScrollStarted()
    coordinator.setActive(1) // A measure mid-scroll must not switch the source.
    expect(player.loadVideoById).not.toHaveBeenCalled()
    coordinator.commitSwipeTarget(1)
    // Asserted immediately after the synchronous call: the switch left
    // inside the gesture-end handler, never deferred (memo §A).
    expect(player.loadVideoById).toHaveBeenCalledOnce()
    expect(player.loadVideoById).toHaveBeenCalledWith(testVideos[1].externalVideoId)
    expect(player.unMute).toHaveBeenCalledOnce()
    expect(player.unMute.mock.invocationCallOrder[0])
      .toBeLessThan(player.loadVideoById.mock.invocationCallOrder[0])
    expect(coordinator.getDisplayIndex()).toBe(1)
  })

  it('commits once per episode across gesture end, settle and repeated end events', () => {
    const { coordinator, player } = setup()
    coordinator.startFromGesture(0)
    coordinator.noteScrollStarted()
    coordinator.commitSwipeTarget(1)
    coordinator.commitSwipeTarget(1) // The same gesture's second end event.
    coordinator.noteScrollEpisodeEnd()
    coordinator.commitSettleTarget(1) // Settle for the same episode.
    expect(player.loadVideoById).toHaveBeenCalledOnce()
    expect(player.playVideo).toHaveBeenCalledOnce() // Only the start tap's start.
  })

  it('adopts the measured landing when the episode closes without a commit', () => {
    const { coordinator, player } = setup()
    coordinator.startFromGesture(0)
    coordinator.noteScrollStarted()
    coordinator.setActive(2)
    expect(player.loadVideoById).not.toHaveBeenCalled()
    coordinator.noteScrollEpisodeEnd()
    expect(player.loadVideoById).toHaveBeenCalledWith(testVideos[2].externalVideoId)
    expect(coordinator.getDisplayIndex()).toBe(2)
  })

  it('does not switch when the episode closes on the starting card (snap-back)', () => {
    const { coordinator, player } = setup()
    coordinator.startFromGesture(0)
    coordinator.noteScrollStarted()
    coordinator.setActive(0)
    coordinator.noteScrollEpisodeEnd()
    expect(player.loadVideoById).not.toHaveBeenCalled()
    expect(coordinator.getDisplayIndex()).toBe(0)
  })
})

describe('single-player blocked handling', () => {
  // Drive the coordinator to a blocked landing on video 2 whose
  // gesture window has already expired, so no window retry fires.
  const blockedLanding = () => {
    const { coordinator, player } = setup()
    coordinator.startFromGesture(0)
    coordinator.noteScrollStarted()
    coordinator.commitSwipeTarget(1)
    now += 10_000
    coordinator.onAutoplayBlocked()
    return { coordinator, player }
  }

  it('retries a blocked landing at settle, restarting the loaded video (round 8 authority)', () => {
    const { coordinator, player } = blockedLanding()
    player.unMute.mockClear(); player.playVideo.mockClear()
    coordinator.commitSettleTarget(1)
    expect(player.unMute).toHaveBeenCalledOnce()
    expect(player.playVideo).toHaveBeenCalledOnce()
    expect(player.loadVideoById).toHaveBeenCalledOnce() // The original switch only.
  })

  it('retries a block that lands inside the gesture window exactly once', () => {
    const { coordinator, player } = setup()
    coordinator.startFromGesture(0)
    coordinator.noteScrollStarted()
    coordinator.commitSwipeTarget(1)
    player.playVideo.mockClear()
    coordinator.onAutoplayBlocked() // Same gesture stamp: inside the window.
    expect(player.playVideo).toHaveBeenCalledOnce()
    coordinator.onAutoplayBlocked() // The retry spent this gesture's one try.
    expect(player.playVideo).toHaveBeenCalledOnce()
  })

  it('keeps the tap fallback: play() retries only the active loaded video', () => {
    const { coordinator, player } = blockedLanding()
    player.playVideo.mockClear()
    coordinator.play(0) // Not the active item.
    expect(player.playVideo).not.toHaveBeenCalled()
    coordinator.play(1)
    expect(player.playVideo).toHaveBeenCalledOnce()
  })

  it('retries a blocked active video on the next genuine gesture', () => {
    const { coordinator, player } = blockedLanding()
    player.playVideo.mockClear()
    coordinator.handleUserGesture()
    expect(player.playVideo).toHaveBeenCalledOnce()
  })
})

describe('single-player playback state', () => {
  it('loops the active video when it ends', () => {
    const { coordinator, player } = setup()
    coordinator.startFromGesture(0)
    coordinator.onStateChange(1)
    player.seekTo.mockClear(); player.playVideo.mockClear(); player.unMute.mockClear()
    coordinator.onStateChange(0)
    expect(player.seekTo).toHaveBeenCalledWith(0, true)
    expect(player.unMute).toHaveBeenCalledOnce()
    expect(player.playVideo).toHaveBeenCalledOnce()
  })

  it('opens the gate only while the settled player is playing or buffering', () => {
    const { coordinator } = setup()
    coordinator.startFromGesture(0)
    expect(coordinator.isIframeInteractive()).toBe(false)
    coordinator.onStateChange(3)
    expect(coordinator.isIframeInteractive()).toBe(true)
    coordinator.onStateChange(2) // A deliberate pause closes it again.
    expect(coordinator.isIframeInteractive()).toBe(false)
    coordinator.onStateChange(1)
    expect(coordinator.isIframeInteractive()).toBe(true)
    coordinator.noteScrollStarted() // The next swipe closes it.
    expect(coordinator.isIframeInteractive()).toBe(false)
  })

  it('pauses on hide and on setActive(null), and never restarts a superseded start', () => {
    const { coordinator, player } = setup()
    coordinator.startFromGesture(0)
    coordinator.onStateChange(1)
    player.pauseVideo.mockClear(); player.playVideo.mockClear()
    coordinator.setActive(0) // Same item measured again: no restart.
    expect(player.playVideo).not.toHaveBeenCalled()
    coordinator.setVisible(false)
    expect(player.pauseVideo).toHaveBeenCalledOnce()
    coordinator.setActive(null)
    expect(player.pauseVideo).toHaveBeenCalledTimes(2)
  })
})
