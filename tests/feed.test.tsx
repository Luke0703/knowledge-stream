import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { VideoFeed } from '../src/VideoFeed'
import { testVideos } from '../src/videos'
import { PlaybackCoordinator } from '../src/player/PlaybackCoordinator'
import type { PlayerControl } from '../src/player/PlaybackCoordinator'

const players = vi.hoisted(() => new Map<number, PlayerControl>())
const created = vi.hoisted(() => [] as PlayerControl[])
vi.mock('../src/player/YouTubePlayer', async () => {
  const { createElement, useLayoutEffect, useState } = await import('react')
  return { YouTubePlayer: ({ index, coordinator, load }: { index: number; coordinator: PlaybackCoordinator; load: boolean }) => {
    const [player] = useState(() => {
      const result = { pauseVideo: vi.fn(), playVideo: vi.fn(), mute: vi.fn(), unMute: vi.fn(), seekTo: vi.fn() }
      created.push(result)
      return result
    })
    useLayoutEffect(() => {
      if (!load) return
      players.set(index, player)
      coordinator.register(index, player)
      return () => { coordinator.unregister(index, player); players.delete(index) }
    }, [index, coordinator, load, player])
    return createElement('div', { className: 'player-surface' })
  } }
})

let position = 0
let scrollWorks = true
const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo')
beforeEach(() => {
  players.clear(); created.length = 0; position = 0; scrollWorks = true
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
    configurable: true,
    value: vi.fn(function (this: HTMLElement, options: ScrollToOptions) {
      if (scrollWorks) { position = (options.top ?? 0) / 600; this.scrollTop = options.top ?? 0 }
    }),
  })
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (this.classList.contains('feed')) return new DOMRect(0, 0, 390, 600)
    const card = this.closest('.video-card')!
    const index = Array.from(card.parentElement!.children).indexOf(card)
    const top = (index - position) * 600
    return this.classList.contains('player-surface')
      ? new DOMRect(0, top + 60, 240, 420) : new DOMRect(0, top, 390, 600)
  })
})
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals()
  if (originalScroll) Object.defineProperty(HTMLElement.prototype, 'scrollTo', originalScroll)
  else delete (HTMLElement.prototype as Partial<HTMLElement>).scrollTo
})

it('requests the ready next player synchronously without waiting for a scroll event', () => {
  render(<VideoFeed videos={testVideos} />)
  const first = players.get(0)!, next = players.get(1)!
  vi.mocked(first.pauseVideo).mockClear()
  act(() => {
    fireEvent.click(screen.getByRole('button', { name: '次へ ↓' }))
    // Assert inside the event turn, before any asynchronous scroll event.
    expect(next.playVideo).toHaveBeenCalledOnce()
  })
  expect(vi.mocked(first.pauseVideo).mock.invocationCallOrder[0])
    .toBeLessThan(vi.mocked(next.playVideo).mock.invocationCallOrder[0])
})

it('does not authorize the target when scrolling fails to make it visible', () => {
  render(<VideoFeed videos={testVideos} />)
  scrollWorks = false
  fireEvent.click(screen.getByRole('button', { name: '次へ ↓' }))
  expect(players.get(1)!.playVideo).not.toHaveBeenCalled()
})

it('loads the card in the feed even when viewport clipping prevents autoplay', () => {
  render(<VideoFeed videos={testVideos} preloadAdjacent={false} />)
  vi.stubGlobal('innerHeight', 250)
  position = 2
  fireEvent.scroll(screen.getByRole('main', { name: '動画フィード' }))
  expect([...players.keys()]).toEqual([2])
  expect(players.get(2)!.playVideo).not.toHaveBeenCalled()
  expect(screen.getByText('3 / 3')).toBeTruthy()
  vi.stubGlobal('innerHeight', 800)
  fireEvent.resize(window)
  expect(players.get(2)!.playVideo).toHaveBeenCalledOnce()
})

it('loads the nearest card during an unsettled scroll without authorizing playback', () => {
  render(<VideoFeed videos={testVideos} preloadAdjacent={false} />)
  position = 1.6 // Neither card meets the 65% autoplay threshold.
  fireEvent.scroll(screen.getByRole('main', { name: '動画フィード' }))
  expect([...players.keys()]).toEqual([2])
  expect(players.get(2)!.playVideo).not.toHaveBeenCalled()
  position = 2
  fireEvent.scroll(screen.getByRole('main', { name: '動画フィード' }))
  expect(players.get(2)!.playVideo).toHaveBeenCalledOnce()
})

it('requests playback for an entering card past the early threshold before it settles', () => {
  render(<VideoFeed videos={testVideos} />)
  position = 1.62 // Card 2 fills 62%: past the 60% early threshold, short of the 65% settle threshold.
  fireEvent.scroll(screen.getByRole('main', { name: '動画フィード' }))
  // The first measure promotes card 2 to the load center and mounts its
  // player; the next measure of the same approach issues the early attempt.
  fireEvent.scroll(screen.getByRole('main', { name: '動画フィード' }))
  expect(players.get(2)!.unMute).toHaveBeenCalledOnce()
  expect(players.get(2)!.playVideo).toHaveBeenCalledOnce()
})

it('commits the swipe target inside the gesture-end handler, before any settle', () => {
  render(<VideoFeed videos={testVideos} />)
  const feed = screen.getByRole('main', { name: '動画フィード' })
  const next = players.get(1)!
  // The swipe stays below the 65% settle and 60% early thresholds while
  // it moves, but leaves with enough velocity to carry the snap to the
  // next card: no request may fire during the scroll itself…
  position = 0.4; feed.scrollTop = 240
  fireEvent.scroll(feed)
  position = 0.55; feed.scrollTop = 330
  fireEvent.scroll(feed)
  expect(next.playVideo).not.toHaveBeenCalled()
  // …and the commit lands synchronously in the gesture-end turn.
  act(() => {
    fireEvent.pointerUp(window)
    expect(next.playVideo).toHaveBeenCalledOnce()
  })
  expect(next.unMute).toHaveBeenCalledOnce()
})

it('commits only once when one gesture ends through several event types', () => {
  render(<VideoFeed videos={testVideos} />)
  const feed = screen.getByRole('main', { name: '動画フィード' })
  const next = players.get(1)!
  position = 0.4; feed.scrollTop = 240
  fireEvent.scroll(feed)
  position = 0.55; feed.scrollTop = 330
  fireEvent.scroll(feed)
  fireEvent.pointerUp(window)
  fireEvent.touchEnd(window) // The same physical gesture's second end event.
  expect(next.playVideo).toHaveBeenCalledOnce()
})

it('does not commit when a short, slow swipe will snap back', () => {
  render(<VideoFeed videos={testVideos} />)
  const feed = screen.getByRole('main', { name: '動画フィード' })
  position = 0.2; feed.scrollTop = 120
  fireEvent.scroll(feed)
  fireEvent.pointerUp(window)
  expect(players.get(1)!.playVideo).not.toHaveBeenCalled()
})

it('commits the settled target when scrolling stops without a final scroll event', () => {
  vi.useFakeTimers()
  const raf = vi.fn((callback: FrameRequestCallback) => { callback(0); return 0 })
  vi.stubGlobal('requestAnimationFrame', raf)
  try {
    render(<VideoFeed videos={testVideos} />)
    const feed = screen.getByRole('main', { name: '動画フィード' })
    const next = players.get(1)!
    position = 0.4; feed.scrollTop = 240
    fireEvent.scroll(feed)
    position = 0.55; feed.scrollTop = 330
    fireEvent.scroll(feed)
    expect(next.playVideo).not.toHaveBeenCalled()
    // The snap lands on the next card without a further scroll event
    // reaching the parent (momentum events coalesced on iOS).
    position = 1; feed.scrollTop = 600
    act(() => { vi.advanceTimersByTime(200) })
    expect(next.unMute).toHaveBeenCalledOnce()
    expect(next.playVideo).toHaveBeenCalledOnce()
  } finally {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  }
})

it('commits the settled target on the native scrollend event', () => {
  render(<VideoFeed videos={testVideos} />)
  const feed = screen.getByRole('main', { name: '動画フィード' })
  const next = players.get(1)!
  position = 0.4; feed.scrollTop = 240
  fireEvent.scroll(feed)
  position = 0.55; feed.scrollTop = 330
  fireEvent.scroll(feed)
  expect(next.playVideo).not.toHaveBeenCalled()
  position = 1; feed.scrollTop = 600
  act(() => { feed.dispatchEvent(new Event('scrollend')) })
  expect(next.unMute).toHaveBeenCalledOnce()
  expect(next.playVideo).toHaveBeenCalledOnce()
})

it('commits only once when the gesture end and the settle both fire', () => {
  render(<VideoFeed videos={testVideos} />)
  const feed = screen.getByRole('main', { name: '動画フィード' })
  const next = players.get(1)!
  position = 0.4; feed.scrollTop = 240
  fireEvent.scroll(feed)
  position = 0.55; feed.scrollTop = 330
  fireEvent.scroll(feed)
  fireEvent.pointerUp(window) // Gesture-end commit.
  expect(next.playVideo).toHaveBeenCalledOnce()
  position = 1; feed.scrollTop = 600
  act(() => { feed.dispatchEvent(new Event('scrollend')) }) // Settle for the same episode: no second request.
  expect(next.playVideo).toHaveBeenCalledOnce()
})

it('commits only once when the settle fires before the gesture end', () => {
  render(<VideoFeed videos={testVideos} />)
  const feed = screen.getByRole('main', { name: '動画フィード' })
  const next = players.get(1)!
  position = 0.4; feed.scrollTop = 240
  fireEvent.scroll(feed)
  position = 0.55; feed.scrollTop = 330
  fireEvent.scroll(feed)
  position = 1; feed.scrollTop = 600
  act(() => { feed.dispatchEvent(new Event('scrollend')) }) // Settle commit.
  expect(next.playVideo).toHaveBeenCalledOnce()
  fireEvent.pointerUp(window) // The same gesture's end event: no second request.
  expect(next.playVideo).toHaveBeenCalledOnce()
})

it('promotes an early-started player at settle without a duplicate request', () => {
  const coordinator = new PlaybackCoordinator()
  render(<VideoFeed videos={testVideos} coordinator={coordinator} />)
  const feed = screen.getByRole('main', { name: '動画フィード' })
  position = 1.62 // Card 3 fills 62%: past the 60% early threshold, short of the 65% settle threshold.
  fireEvent.scroll(feed)
  fireEvent.scroll(feed)
  const target = players.get(2)!
  expect(target.playVideo).toHaveBeenCalledOnce() // The round-4 early attempt.
  act(() => { coordinator.onStateChange(2, target, 3) }) // Buffering: the early attempt is working.
  position = 2; feed.scrollTop = 1200
  act(() => { feed.dispatchEvent(new Event('scrollend')) }) // Settle promotes instead of re-requesting.
  expect(target.playVideo).toHaveBeenCalledOnce()
  expect(coordinator.canPlay(2)).toBe(true)
})

it('re-issues the start at settle when the landing card was already activated and blocked mid-scroll (round 8)', () => {
  const coordinator = new PlaybackCoordinator()
  render(<VideoFeed videos={testVideos} coordinator={coordinator} />)
  const feed = screen.getByRole('main', { name: '動画フィード' })
  const next = players.get(1)!
  position = 0.4; feed.scrollTop = 240
  fireEvent.scroll(feed) // The scroll episode begins on card 1.
  // The snap lands: this measure activates card 2 mid-scroll and its
  // reconcile start is issued…
  position = 1; feed.scrollTop = 600
  fireEvent.scroll(feed)
  expect(next.playVideo).toHaveBeenCalledOnce()
  // …and YouTube blocks it. No parent-side gesture stamp is fresh, so
  // no gesture-window retry fires: the card sits active and blocked —
  // the 2026-11-14 device state in which round 7's settle commit
  // silently returned without emitting settleCommit.
  act(() => { coordinator.onAutoplayBlocked(1) })
  vi.mocked(next.playVideo).mockClear(); vi.mocked(next.unMute).mockClear()
  act(() => { feed.dispatchEvent(new Event('scrollend')) }) // Settle: the authoritative commit retries.
  expect(next.unMute).toHaveBeenCalledOnce()
  expect(next.playVideo).toHaveBeenCalledOnce()
  expect(coordinator.canPlay(1)).toBe(true)
})

it('does not commit at settle when the swipe snaps back to the starting card', () => {
  vi.useFakeTimers()
  const raf = vi.fn((callback: FrameRequestCallback) => { callback(0); return 0 })
  vi.stubGlobal('requestAnimationFrame', raf)
  try {
    render(<VideoFeed videos={testVideos} />)
    const feed = screen.getByRole('main', { name: '動画フィード' })
    position = 0.2; feed.scrollTop = 120
    fireEvent.scroll(feed)
    // The snap carries the card back without a gesture-end event
    // reaching the parent (the device case).
    position = 0; feed.scrollTop = 0
    act(() => { vi.advanceTimersByTime(200) })
    expect(players.get(1)!.playVideo).not.toHaveBeenCalled()
  } finally {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  }
})

it.each([true, false])('bounds mounted players over 100 transitions (preload=%s) and releases them on unmount', preloadAdjacent => {
  const view = render(<VideoFeed videos={testVideos} preloadAdjacent={preloadAdjacent} />)
  const retired: PlayerControl[] = []
  for (let step = 0; step < 100; step++) {
    const previous = players.get(position)!
    vi.mocked(previous.pauseVideo).mockClear()
    const forward = step % 4 < 2
    fireEvent.click(screen.getByRole('button', { name: forward ? '次へ ↓' : '↑ 前へ' }))
    expect(previous.pauseVideo).toHaveBeenCalled()
    const expected = preloadAdjacent
      ? [0, 1, 2].filter(index => Math.abs(index - position) <= 1) : [position]
    expect([...players.keys()].sort()).toEqual(expected)
    if (!preloadAdjacent) {
      retired.push(previous)
      expect(players.get(position)!.playVideo).toHaveBeenCalledOnce()
    }
  }
  // Each retired player was started exactly once, never restarted by later navigation.
  for (const player of retired) expect(player.playVideo).toHaveBeenCalledOnce()
  if (preloadAdjacent) expect(created).toHaveLength(3)
  view.unmount()
  expect(players.size).toBe(0)
})
