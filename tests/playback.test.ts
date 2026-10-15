import { describe, expect, it, vi } from 'vitest'
import { PlaybackCoordinator } from '../src/player/PlaybackCoordinator'
import { inMountWindow, selectActive } from '../src/player/visibility'

const player = () => ({ pauseVideo: vi.fn(), mute: vi.fn(), playVideo: vi.fn() })

describe('visibility and mount window', () => {
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
  it('pauses the previous player before muted autoplay of the next', () => {
    const coordinator = new PlaybackCoordinator(), first = player(), next = player()
    coordinator.register(0, first); coordinator.register(1, next)
    coordinator.setActive(0)
    first.pauseVideo.mockClear()
    coordinator.setActive(1)
    expect(first.pauseVideo).toHaveBeenCalledOnce()
    expect(next.playVideo).toHaveBeenCalledOnce()
    expect(first.pauseVideo.mock.invocationCallOrder[0]).toBeLessThan(next.playVideo.mock.invocationCallOrder[0])
    expect(next.mute.mock.invocationCallOrder[0]).toBeLessThan(next.playVideo.mock.invocationCallOrder[0])
  })
  it('never starts a late-ready inactive player and rejects late/manual playing events', () => {
    const coordinator = new PlaybackCoordinator(), stale = player()
    coordinator.setActive(2); coordinator.register(0, stale)
    expect(stale.playVideo).not.toHaveBeenCalled()
    coordinator.onStateChange(0, stale, 1)
    coordinator.onStateChange(0, stale, 3)
    expect(stale.pauseVideo).toHaveBeenCalledTimes(3)
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
