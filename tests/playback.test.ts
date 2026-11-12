import { describe, expect, it, vi } from 'vitest'
import { PlaybackCoordinator } from '../src/player/PlaybackCoordinator'
import { decideSwipeTarget, inMountWindow, retainedPlayers, selectActive } from '../src/player/visibility'

const player = () => ({ pauseVideo: vi.fn(), mute: vi.fn(), unMute: vi.fn(), playVideo: vi.fn(), seekTo: vi.fn() })

describe('visibility and mount window', () => {
  it('bounds reuse at three while always keeping the entire media load window', () => {
    let retained: number[] = []
    for (const center of [0, 1, 2, 3, 4, 3, 2, 1, 0]) {
      retained = retainedPlayers(center, 5, retained)
      expect(retained.length).toBeLessThanOrEqual(3)
      for (let i = 0; i < 5; i++) if (inMountWindow(i, center)) expect(retained).toContain(i)
    }
    expect(retainedPlayers(4, 5, retained, false)).toEqual([4])
  })
  it('has no active video between snaps or with a clipped player', () => {
    expect(selectActive([{ index: 0, cardRatio: .64, playerRatio: 1 }, { index: 1, cardRatio: .36, playerRatio: 1 }])).toBeNull()
    expect(selectActive([{ index: 0, cardRatio: 1, playerRatio: .49 }])).toBeNull()
    expect(selectActive([{ index: 2, cardRatio: .65, playerRatio: .5 }])).toBe(2)
    expect(selectActive([])).toBeNull()
  })
  it('keeps only current ±1, including first and last boundaries', () => {
    const indices = [0, 1, 2, 3, 4]
    expect(indices.filter(i => inMountWindow(i, 0))).toEqual([0, 1])
    expect(indices.filter(i => inMountWindow(i, 2))).toEqual([1, 2, 3])
    expect(indices.filter(i => inMountWindow(i, 4))).toEqual([3, 4])
  })
})

describe('playback ownership', () => {
  it('allows an explicit play retry only for the ready, visible active player', () => {
    const coordinator = new PlaybackCoordinator(), first = player(), next = player()
    coordinator.setActive(0)
    coordinator.play(0) // Not ready yet: do not queue a future gesture.
    coordinator.register(0, first); coordinator.register(1, next)
    first.playVideo.mockClear()
    coordinator.play(1)
    expect(next.playVideo).not.toHaveBeenCalled()
    coordinator.play(0)
    expect(first.playVideo).toHaveBeenCalledOnce()
    coordinator.setVisible(false); coordinator.play(0)
    expect(first.playVideo).toHaveBeenCalledOnce()
    coordinator.unregister(0, first); coordinator.setVisible(true); coordinator.play(0)
    expect(first.playVideo).toHaveBeenCalledOnce()
  })
  it('requests sound on at each explicit or automatic start', () => {
    const coordinator = new PlaybackCoordinator(), current = player()
    coordinator.setActive(0); coordinator.register(0, current)
    expect(current.unMute).toHaveBeenCalledOnce()
    coordinator.setActive(null); coordinator.setActive(0); coordinator.play(0)
    coordinator.unregister(0, current); coordinator.register(0, current)
    expect(current.unMute).toHaveBeenCalledTimes(4)
    expect(current.mute).not.toHaveBeenCalled()
  })
  it('pauses the previous player before requesting sound-on autoplay of the next', () => {
    const coordinator = new PlaybackCoordinator(), first = player(), next = player()
    coordinator.register(0, first); coordinator.register(1, next)
    coordinator.setActive(0)
    first.pauseVideo.mockClear()
    coordinator.setActive(1)
    expect(first.pauseVideo).toHaveBeenCalledOnce()
    expect(next.playVideo).toHaveBeenCalledOnce()
    expect(first.pauseVideo.mock.invocationCallOrder[0]).toBeLessThan(next.playVideo.mock.invocationCallOrder[0])
    expect(next.unMute.mock.invocationCallOrder[0]).toBeLessThan(next.playVideo.mock.invocationCallOrder[0])
    expect(next.mute).not.toHaveBeenCalled()
  })
  it('never starts a late-ready inactive player and rejects late/manual playing events', () => {
    const coordinator = new PlaybackCoordinator(), stale = player()
    coordinator.setActive(2); coordinator.register(0, stale)
    expect(stale.playVideo).not.toHaveBeenCalled()
    coordinator.onStateChange(0, stale, 1)
    coordinator.onStateChange(0, stale, 3)
    expect(stale.pauseVideo).toHaveBeenCalledTimes(3)
  })
  it('retries a blocked sound-on start once, inside the first real user gesture', () => {
    const coordinator = new PlaybackCoordinator(), current = player()
    coordinator.setActive(0); coordinator.register(0, current)
    current.playVideo.mockClear(); current.unMute.mockClear()
    coordinator.handleUserGesture() // No block recorded: nothing to retry.
    expect(current.playVideo).not.toHaveBeenCalled()
    coordinator.onAutoplayBlocked(0)
    coordinator.handleUserGesture()
    expect(current.unMute).toHaveBeenCalledOnce()
    expect(current.playVideo).toHaveBeenCalledOnce()
    expect(current.unMute.mock.invocationCallOrder[0]).toBeLessThan(current.playVideo.mock.invocationCallOrder[0])
    coordinator.handleUserGesture() // One-shot: a later tap does not restart it.
    expect(current.playVideo).toHaveBeenCalledOnce()
  })
  it('retries a block that lands just after a genuine gesture, once per gesture (the swipe case)', () => {
    let now = 1000
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    try {
      const coordinator = new PlaybackCoordinator(), current = player()
      coordinator.setActive(0); coordinator.register(0, current)
      current.playVideo.mockClear(); current.unMute.mockClear()
      coordinator.handleUserGesture() // The swipe: stamps the gesture, nothing blocked yet.
      now += 800 // The feed settles, the start attempt runs, YouTube blocks it.
      coordinator.onAutoplayBlocked(0)
      expect(current.unMute).toHaveBeenCalledOnce()
      expect(current.playVideo).toHaveBeenCalledOnce() // Retried on the swipe's own activation.
      coordinator.onAutoplayBlocked(0) // The retry blocked too: the same gesture buys no second retry.
      expect(current.playVideo).toHaveBeenCalledOnce()
      now += 5000
      coordinator.handleUserGesture() // A genuinely new gesture retries the recorded block.
      expect(current.playVideo).toHaveBeenCalledTimes(2)
    } finally { vi.restoreAllMocks() }
  })
  it('keeps a block waiting for a tap when no recent gesture precedes it', () => {
    let now = 1000
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    try {
      const coordinator = new PlaybackCoordinator(), current = player()
      coordinator.setActive(0); coordinator.register(0, current)
      coordinator.handleUserGesture() // A gesture long before the block.
      current.playVideo.mockClear()
      now += 60000
      coordinator.onAutoplayBlocked(0) // Far outside the gesture window: no retry.
      expect(current.playVideo).not.toHaveBeenCalled()
      coordinator.handleUserGesture()
      expect(current.playVideo).toHaveBeenCalledOnce()
    } finally { vi.restoreAllMocks() }
  })
  it('does not auto-retry a block for a non-active player after a gesture', () => {
    let now = 1000
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    try {
      const coordinator = new PlaybackCoordinator(), first = player(), next = player()
      coordinator.register(0, first); coordinator.register(1, next)
      coordinator.setActive(0)
      coordinator.handleUserGesture()
      next.playVideo.mockClear()
      coordinator.onAutoplayBlocked(1)
      expect(next.playVideo).not.toHaveBeenCalled()
    } finally { vi.restoreAllMocks() }
  })
  it('does not let a gesture restart a player that already reached playback', () => {
    const coordinator = new PlaybackCoordinator(), current = player()
    coordinator.setActive(0); coordinator.register(0, current)
    coordinator.onAutoplayBlocked(0)
    coordinator.onStateChange(0, current, 1) // Playback began; the block is history.
    current.playVideo.mockClear()
    coordinator.handleUserGesture()
    expect(current.playVideo).not.toHaveBeenCalled()
  })
  it('ignores gestures while hidden or when only a non-active player is blocked', () => {
    const coordinator = new PlaybackCoordinator(), first = player(), next = player()
    coordinator.register(0, first); coordinator.register(1, next)
    coordinator.setActive(0)
    coordinator.onAutoplayBlocked(1)
    next.playVideo.mockClear()
    coordinator.handleUserGesture()
    expect(next.playVideo).not.toHaveBeenCalled()
    coordinator.onAutoplayBlocked(0)
    coordinator.setVisible(false)
    first.playVideo.mockClear()
    coordinator.handleUserGesture()
    expect(first.playVideo).not.toHaveBeenCalled()
  })
  it('holds playback during preparation: ready players register but are never started', () => {
    const coordinator = new PlaybackCoordinator(), current = player(), next = player()
    coordinator.setHeld(true)
    coordinator.setActive(0)
    coordinator.register(0, current); coordinator.register(1, next)
    expect(coordinator.isReady(0)).toBe(true)
    expect(coordinator.canPlay(0)).toBe(false)
    expect(current.playVideo).not.toHaveBeenCalled()
    expect(next.playVideo).not.toHaveBeenCalled()
    coordinator.setVisible(false); coordinator.setVisible(true) // Visibility flips must not release the hold.
    coordinator.handleUserGesture() // Nor may an ordinary tap during preparation.
    expect(current.playVideo).not.toHaveBeenCalled()
  })
  it('starts the already-ready player synchronously from the decisive gesture', () => {
    let now = 1000
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    try {
      const coordinator = new PlaybackCoordinator(), current = player(), next = player()
      coordinator.setHeld(true)
      coordinator.register(0, current); coordinator.register(1, next)
      current.playVideo.mockClear(); current.unMute.mockClear()
      now += 30000 // Long preparation: the earlier page-load moment must not matter.
      coordinator.startFromGesture(0) // Called inside the tap's own handler.
      expect(coordinator.isHeld()).toBe(false)
      expect(coordinator.canPlay(0)).toBe(true)
      expect(current.unMute).toHaveBeenCalledOnce()
      expect(current.playVideo).toHaveBeenCalledOnce()
      expect(current.unMute.mock.invocationCallOrder[0]).toBeLessThan(current.playVideo.mock.invocationCallOrder[0])
      expect(next.playVideo).not.toHaveBeenCalled()
      expect(next.pauseVideo).toHaveBeenCalled()
    } finally { vi.restoreAllMocks() }
  })
  it('arms the active index when the decisive gesture precedes readiness, and register starts it', () => {
    const coordinator = new PlaybackCoordinator(), current = player()
    coordinator.setHeld(true)
    coordinator.startFromGesture(0) // No player registered yet: nothing can be sent synchronously.
    expect(coordinator.canPlay(0)).toBe(true)
    coordinator.register(0, current) // Fallback path: the request is issued on ready and may still be blocked.
    expect(current.playVideo).toHaveBeenCalledOnce()
  })
  it('notifies ready subscribers on register and unregister', () => {
    const coordinator = new PlaybackCoordinator(), current = player()
    const listener = vi.fn()
    const unsubscribe = coordinator.subscribeReady(listener)
    coordinator.register(0, current)
    expect(listener).toHaveBeenCalledOnce()
    expect(coordinator.isReady(0)).toBe(true)
    coordinator.unregister(0, current)
    expect(listener).toHaveBeenCalledTimes(2)
    expect(coordinator.isReady(0)).toBe(false)
    unsubscribe()
    coordinator.register(0, current)
    expect(listener).toHaveBeenCalledTimes(2)
  })
  it('issues one early sound-on attempt for the entering player and pauses the current one', () => {
    const coordinator = new PlaybackCoordinator(), first = player(), next = player()
    coordinator.register(0, first); coordinator.register(1, next)
    coordinator.setActive(0)
    first.pauseVideo.mockClear(); next.unMute.mockClear(); next.playVideo.mockClear()
    coordinator.attemptEarlyStart(1) // Mid-scroll: the entering item passed the early threshold.
    expect(next.unMute).toHaveBeenCalledOnce()
    expect(next.playVideo).toHaveBeenCalledOnce()
    expect(next.unMute.mock.invocationCallOrder[0]).toBeLessThan(next.playVideo.mock.invocationCallOrder[0])
    expect(first.pauseVideo).toHaveBeenCalled() // No overlapping audio while it approaches.
    coordinator.attemptEarlyStart(1) // Same approach: no second attempt.
    expect(next.playVideo).toHaveBeenCalledOnce()
  })
  it('keeps an early-started player playing while the scroll is unsettled', () => {
    const coordinator = new PlaybackCoordinator(), first = player(), next = player()
    coordinator.register(0, first); coordinator.register(1, next)
    coordinator.setActive(0)
    coordinator.attemptEarlyStart(1)
    next.pauseVideo.mockClear()
    coordinator.onStateChange(1, next, 1) // Its own playing event must not pause it.
    expect(next.pauseVideo).not.toHaveBeenCalled()
    coordinator.setActive(null) // Between snaps neither item is active: the early start survives.
    expect(next.pauseVideo).not.toHaveBeenCalled()
  })
  it('does not duplicate the start at settle when the early attempt already reached playback', () => {
    const coordinator = new PlaybackCoordinator(), first = player(), next = player()
    coordinator.register(0, first); coordinator.register(1, next)
    coordinator.setActive(0)
    coordinator.attemptEarlyStart(1)
    coordinator.onStateChange(1, next, 3) // Buffering: the early attempt is working.
    next.playVideo.mockClear()
    coordinator.setActive(1) // Promotion: no second request for a player already starting.
    expect(next.playVideo).not.toHaveBeenCalled()
    expect(coordinator.canPlay(1)).toBe(true)
  })
  it('retries a blocked early attempt exactly once more, at settle', () => {
    const coordinator = new PlaybackCoordinator(), first = player(), next = player()
    coordinator.register(0, first); coordinator.register(1, next)
    coordinator.setActive(0)
    coordinator.attemptEarlyStart(1)
    expect(next.playVideo).toHaveBeenCalledOnce()
    coordinator.onAutoplayBlocked(1) // Blocked mid-scroll: recorded only, no early retry is spent.
    expect(next.playVideo).toHaveBeenCalledOnce()
    coordinator.setActive(1) // Settle: the one remaining try.
    expect(next.playVideo).toHaveBeenCalledTimes(2)
    coordinator.onAutoplayBlocked(1) // Blocked again, with no parent-side gesture to spend: it waits.
    expect(next.playVideo).toHaveBeenCalledTimes(2)
  })
  it('abandons the early attempt when the scroll settles back on the previous item', () => {
    const coordinator = new PlaybackCoordinator(), first = player(), next = player()
    coordinator.register(0, first); coordinator.register(1, next)
    coordinator.setActive(0)
    coordinator.attemptEarlyStart(1)
    coordinator.onStateChange(1, next, 1)
    next.pauseVideo.mockClear()
    coordinator.setActive(null) // Mid-scroll: neither item is active, the early start survives.
    expect(next.pauseVideo).not.toHaveBeenCalled()
    coordinator.setActive(0) // Settled back on the previous item: the early player is paused again.
    expect(next.pauseVideo).toHaveBeenCalled()
    coordinator.attemptEarlyStart(1) // A fresh approach may try again.
    expect(next.playVideo).toHaveBeenCalledTimes(2)
  })
  it('refuses early attempts while held, hidden, for the active item, or before readiness', () => {
    const coordinator = new PlaybackCoordinator(), first = player(), next = player()
    coordinator.register(0, first); coordinator.register(1, next)
    coordinator.setActive(0)
    next.playVideo.mockClear()
    coordinator.attemptEarlyStart(0) // Already the active item: the settle path owns it.
    expect(first.playVideo).toHaveBeenCalledOnce() // Only the register/settle start from setup.
    coordinator.setVisible(false)
    coordinator.attemptEarlyStart(1)
    expect(next.playVideo).not.toHaveBeenCalled()
    coordinator.setVisible(true)
    coordinator.attemptEarlyStart(2) // No such player registered.
    expect(next.playVideo).not.toHaveBeenCalled()
    const held = new PlaybackCoordinator(), heldNext = player()
    held.setHeld(true)
    held.register(0, player()); held.register(1, heldNext)
    held.setActive(0)
    held.attemptEarlyStart(1) // Preparation hold: no play request may leave before the decisive tap.
    expect(heldNext.playVideo).not.toHaveBeenCalled()
  })
  it('starts the entering player on a later measure once it registers mid-approach', () => {
    const coordinator = new PlaybackCoordinator(), first = player(), next = player()
    coordinator.register(0, first)
    coordinator.setActive(0)
    coordinator.attemptEarlyStart(1) // Not registered yet: nothing to send to.
    coordinator.register(1, next) // Registers paused (not active, no early marker yet).
    expect(next.playVideo).not.toHaveBeenCalled()
    coordinator.attemptEarlyStart(1) // The feed re-calls on the next measure of the same scroll.
    expect(next.playVideo).toHaveBeenCalledOnce()
  })
  it('pauses while hidden or between snaps, and does not restart on unchanged measurements', () => {
    const coordinator = new PlaybackCoordinator(), current = player()
    coordinator.setActive(0); coordinator.register(0, current)
    coordinator.setActive(0)
    expect(current.playVideo).toHaveBeenCalledOnce()
    coordinator.setVisible(false)
    expect(coordinator.canPlay(0)).toBe(false)
    coordinator.setActive(1); coordinator.setActive(0)
    expect(current.playVideo).toHaveBeenCalledOnce()
    coordinator.setVisible(true)
    expect(current.playVideo).toHaveBeenCalledTimes(2)
    coordinator.setActive(null)
    expect(coordinator.canPlay(0)).toBe(false)
    coordinator.unregister(0, current)
    coordinator.setActive(0)
    expect(current.playVideo).toHaveBeenCalledTimes(2)
  })
})

describe('swipe target decision (round 6)', () => {
  it('stays on the current card when the projected landing is still nearest to it', () => {
    expect(decideSwipeTarget(0, 0.2, 3)).toBe(0)
    expect(decideSwipeTarget(0, 0.49, 3)).toBe(0)
    expect(decideSwipeTarget(1, 1.4, 3)).toBe(1)
  })
  it('advances or retreats to the projected snap target', () => {
    expect(decideSwipeTarget(0, 0.5, 3)).toBe(1)
    expect(decideSwipeTarget(0, 0.9, 3)).toBe(1)
    expect(decideSwipeTarget(1, 0.4, 3)).toBe(0)
    expect(decideSwipeTarget(1, 1.6, 3)).toBe(2)
  })
  it('moves at most one card per gesture and stays inside the feed', () => {
    expect(decideSwipeTarget(0, 2.9, 3)).toBe(1)
    expect(decideSwipeTarget(2, -1, 3)).toBe(1)
    expect(decideSwipeTarget(2, 2.9, 3)).toBe(2)
    expect(decideSwipeTarget(0, -0.9, 3)).toBe(0)
  })
})

describe('swipe commit at gesture end (round 6)', () => {
  it('issues the sound-on start for the committed target and pauses the others', () => {
    const coordinator = new PlaybackCoordinator(), first = player(), next = player()
    coordinator.register(0, first); coordinator.register(1, next)
    coordinator.setActive(0)
    first.pauseVideo.mockClear(); next.unMute.mockClear(); next.playVideo.mockClear()
    coordinator.noteScrollStarted()
    coordinator.commitSwipeTarget(1) // Called synchronously from the gesture-end handler.
    expect(next.unMute).toHaveBeenCalledOnce()
    expect(next.playVideo).toHaveBeenCalledOnce()
    expect(next.unMute.mock.invocationCallOrder[0]).toBeLessThan(next.playVideo.mock.invocationCallOrder[0])
    expect(first.pauseVideo).toHaveBeenCalled()
    expect(coordinator.canPlay(1)).toBe(true)
  })
  it('commits once per scroll episode even when several end events fire, then allows the next episode', () => {
    let now = 1000
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    try {
      const coordinator = new PlaybackCoordinator(), first = player(), next = player(), third = player()
      coordinator.register(0, first); coordinator.register(1, next); coordinator.register(2, third)
      coordinator.setActive(0)
      coordinator.noteScrollStarted() // The swipe's episode begins.
      coordinator.commitSwipeTarget(1) // pointerup
      coordinator.commitSwipeTarget(1) // touchend for the same physical gesture: no second request.
      expect(next.playVideo).toHaveBeenCalledOnce()
      now += 1000
      coordinator.noteScrollStarted() // A new swipe: a new episode.
      coordinator.commitSwipeTarget(2)
      expect(third.playVideo).toHaveBeenCalledOnce()
      expect(next.pauseVideo).toHaveBeenCalled() // The previously committed player yields.
    } finally { vi.restoreAllMocks() }
  })
  it('does not duplicate the start when the early attempt for the same target already reached playback', () => {
    const coordinator = new PlaybackCoordinator(), first = player(), next = player()
    coordinator.register(0, first); coordinator.register(1, next)
    coordinator.setActive(0)
    coordinator.attemptEarlyStart(1)
    coordinator.onStateChange(1, next, 3) // Buffering: the early attempt is working.
    next.playVideo.mockClear()
    coordinator.noteScrollStarted()
    coordinator.commitSwipeTarget(1) // Promotion, not a second request.
    expect(next.playVideo).not.toHaveBeenCalled()
    expect(coordinator.canPlay(1)).toBe(true)
  })
  it('spends the gesture on the commit: a block of the committed request waits for the next genuine gesture', () => {
    let now = 1000
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    try {
      const coordinator = new PlaybackCoordinator(), first = player(), next = player()
      coordinator.register(0, first); coordinator.register(1, next)
      coordinator.setActive(0)
      coordinator.noteScrollStarted()
      coordinator.commitSwipeTarget(1)
      expect(next.playVideo).toHaveBeenCalledOnce()
      coordinator.onAutoplayBlocked(1) // The committed request was blocked anyway.
      expect(next.playVideo).toHaveBeenCalledOnce() // No instant gesture-window re-fire: the commit was this gesture's try.
      now += 4000
      coordinator.handleUserGesture() // A genuinely new tap retries the recorded block.
      expect(next.playVideo).toHaveBeenCalledTimes(2)
    } finally { vi.restoreAllMocks() }
  })
  it('keeps the committed player playable between snaps and pauses it when the snap lands elsewhere', () => {
    const coordinator = new PlaybackCoordinator(), first = player(), next = player()
    coordinator.register(0, first); coordinator.register(1, next)
    coordinator.setActive(0)
    coordinator.noteScrollStarted()
    coordinator.commitSwipeTarget(1)
    next.pauseVideo.mockClear()
    coordinator.setActive(null) // Intermediate measure during the remaining snap motion.
    expect(next.pauseVideo).not.toHaveBeenCalled()
    coordinator.setActive(0) // The snap landed back on the previous item after all.
    expect(next.pauseVideo).toHaveBeenCalled()
  })
  it('refuses to commit while held or hidden', () => {
    const coordinator = new PlaybackCoordinator(), first = player(), next = player()
    coordinator.register(0, first); coordinator.register(1, next)
    coordinator.setActive(0)
    coordinator.setVisible(false)
    coordinator.commitSwipeTarget(1)
    expect(next.playVideo).not.toHaveBeenCalled()
    const held = new PlaybackCoordinator(), heldNext = player()
    held.setHeld(true)
    held.register(0, player()); held.register(1, heldNext)
    held.setActive(0)
    held.commitSwipeTarget(1) // Preparation hold: the decisive tap owns the first start.
    expect(heldNext.playVideo).not.toHaveBeenCalled()
  })
  it('still loops the committed active video when it ends', () => {
    const coordinator = new PlaybackCoordinator(), first = player(), next = player()
    coordinator.register(0, first); coordinator.register(1, next)
    coordinator.setActive(0)
    coordinator.noteScrollStarted()
    coordinator.commitSwipeTarget(1)
    next.playVideo.mockClear(); next.unMute.mockClear()
    coordinator.onStateChange(1, next, 0) // ENDED: round 5's loop still applies to the committed item.
    expect(next.seekTo).toHaveBeenCalledWith(0, true)
    expect(next.playVideo).toHaveBeenCalledOnce()
  })
})

describe('settle commit (round 7)', () => {
  it('issues the sound-on start for the settled target and pauses the others', () => {
    const coordinator = new PlaybackCoordinator(), first = player(), next = player()
    coordinator.register(0, first); coordinator.register(1, next)
    coordinator.setActive(0)
    first.pauseVideo.mockClear(); next.unMute.mockClear(); next.playVideo.mockClear()
    coordinator.noteScrollStarted()
    coordinator.commitSettleTarget(1) // Called from the scroll-settle handler.
    expect(next.unMute).toHaveBeenCalledOnce()
    expect(next.playVideo).toHaveBeenCalledOnce()
    expect(next.unMute.mock.invocationCallOrder[0]).toBeLessThan(next.playVideo.mock.invocationCallOrder[0])
    expect(first.pauseVideo).toHaveBeenCalled()
    expect(coordinator.canPlay(1)).toBe(true)
  })
  it('commits once per scroll episode across both paths, in either order', () => {
    let now = 1000
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    try {
      const coordinator = new PlaybackCoordinator(), first = player(), next = player(), third = player()
      coordinator.register(0, first); coordinator.register(1, next); coordinator.register(2, third)
      coordinator.setActive(0)
      coordinator.noteScrollStarted()
      coordinator.commitSettleTarget(1) // Settle fires first.
      coordinator.commitSwipeTarget(1) // The gesture end arrives late: no second request.
      expect(next.playVideo).toHaveBeenCalledOnce()
      now += 1000
      coordinator.noteScrollStarted() // A new swipe: a new episode.
      coordinator.commitSwipeTarget(2) // Gesture end fires first this time.
      coordinator.commitSettleTarget(2) // Settle for the same episode: no second request.
      expect(third.playVideo).toHaveBeenCalledOnce()
      expect(next.pauseVideo).toHaveBeenCalled() // The previously committed player yields.
    } finally { vi.restoreAllMocks() }
  })
  it('does not duplicate the start when the early attempt for the same target already reached playback', () => {
    const coordinator = new PlaybackCoordinator(), first = player(), next = player()
    coordinator.register(0, first); coordinator.register(1, next)
    coordinator.setActive(0)
    coordinator.attemptEarlyStart(1)
    coordinator.onStateChange(1, next, 3) // Buffering: the early attempt is working.
    next.playVideo.mockClear()
    coordinator.noteScrollStarted()
    coordinator.commitSettleTarget(1) // Promotion, not a second request.
    expect(next.playVideo).not.toHaveBeenCalled()
    expect(coordinator.canPlay(1)).toBe(true)
  })
  it('spends the gesture on the settle commit: a block waits for the next genuine gesture', () => {
    let now = 1000
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    try {
      const coordinator = new PlaybackCoordinator(), first = player(), next = player()
      coordinator.register(0, first); coordinator.register(1, next)
      coordinator.setActive(0)
      coordinator.noteScrollStarted()
      coordinator.commitSettleTarget(1)
      expect(next.playVideo).toHaveBeenCalledOnce()
      coordinator.onAutoplayBlocked(1) // The settle request was blocked anyway.
      expect(next.playVideo).toHaveBeenCalledOnce() // No instant gesture-window re-fire: the commit was this gesture's try.
      now += 4000
      coordinator.handleUserGesture() // A genuinely new tap retries the recorded block.
      expect(next.playVideo).toHaveBeenCalledTimes(2)
    } finally { vi.restoreAllMocks() }
  })
  it('refuses to commit at settle while held or hidden', () => {
    const coordinator = new PlaybackCoordinator(), first = player(), next = player()
    coordinator.register(0, first); coordinator.register(1, next)
    coordinator.setActive(0)
    coordinator.setVisible(false)
    coordinator.commitSettleTarget(1)
    expect(next.playVideo).not.toHaveBeenCalled()
    const held = new PlaybackCoordinator(), heldNext = player()
    held.setHeld(true)
    held.register(0, player()); held.register(1, heldNext)
    held.setActive(0)
    held.commitSettleTarget(1) // Preparation hold: the decisive tap owns the first start.
    expect(heldNext.playVideo).not.toHaveBeenCalled()
  })
  it('still loops the settled active video when it ends', () => {
    const coordinator = new PlaybackCoordinator(), first = player(), next = player()
    coordinator.register(0, first); coordinator.register(1, next)
    coordinator.setActive(0)
    coordinator.noteScrollStarted()
    coordinator.commitSettleTarget(1)
    next.playVideo.mockClear(); next.unMute.mockClear()
    coordinator.onStateChange(1, next, 0) // ENDED: round 5's loop still applies to the settled item.
    expect(next.seekTo).toHaveBeenCalledWith(0, true)
    expect(next.playVideo).toHaveBeenCalledOnce()
  })
})

describe('loop playback (round 5)', () => {
  it('restarts the settled active video from the beginning when it ends', () => {
    const coordinator = new PlaybackCoordinator(), current = player()
    coordinator.setActive(0); coordinator.register(0, current)
    current.playVideo.mockClear(); current.unMute.mockClear()
    coordinator.onStateChange(0, current, 0)
    expect(current.seekTo).toHaveBeenCalledWith(0, true)
    expect(current.playVideo).toHaveBeenCalledOnce()
    expect(current.unMute).toHaveBeenCalledOnce()
  })
  it('does not loop a video that is not the active one', () => {
    const coordinator = new PlaybackCoordinator(), first = player(), next = player()
    coordinator.register(0, first); coordinator.register(1, next)
    coordinator.setActive(0)
    next.seekTo.mockClear(); next.playVideo.mockClear()
    coordinator.onStateChange(1, next, 0)
    expect(next.seekTo).not.toHaveBeenCalled()
    expect(next.playVideo).not.toHaveBeenCalled()
  })
  it('does not loop while the document is hidden', () => {
    const coordinator = new PlaybackCoordinator(), current = player()
    coordinator.setActive(0); coordinator.register(0, current)
    coordinator.setVisible(false)
    current.seekTo.mockClear(); current.playVideo.mockClear()
    coordinator.onStateChange(0, current, 0)
    expect(current.seekTo).not.toHaveBeenCalled()
    expect(current.playVideo).not.toHaveBeenCalled()
  })
})
