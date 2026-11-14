import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { VideoFeed } from '../src/VideoFeed'
import { testVideos } from '../src/videos'
import { SinglePlaybackCoordinator } from '../src/player/SinglePlaybackCoordinator'

// Round 10 at feed level: the shared scroll/gesture machinery drives
// the single-player core. The per-card player component must never
// render in single mode, and the one persistent player's switch must
// land synchronously in the gesture-end turn.
const multiRenders = vi.hoisted(() => [] as number[])
vi.mock('../src/player/YouTubePlayer', () => ({
  YouTubePlayer: ({ index }: { index: number }) => { multiRenders.push(index); return null },
  errorMessage: () => '',
}))

const singleControl = vi.hoisted(() => ({
  current: null as null | {
    pauseVideo: ReturnType<typeof vi.fn>; playVideo: ReturnType<typeof vi.fn>; mute: ReturnType<typeof vi.fn>
    unMute: ReturnType<typeof vi.fn>; seekTo: ReturnType<typeof vi.fn>; loadVideoById: ReturnType<typeof vi.fn>
    cueVideoById: ReturnType<typeof vi.fn>
  },
}))
vi.mock('../src/player/SingleYouTubePlayer', async () => {
  const { createElement, useLayoutEffect, useState } = await import('react')
  return {
    SingleYouTubePlayer: ({ coordinator }: { coordinator: SinglePlaybackCoordinator }) => {
      const [control] = useState(() => ({
        pauseVideo: vi.fn(), playVideo: vi.fn(), mute: vi.fn(), unMute: vi.fn(),
        seekTo: vi.fn(), loadVideoById: vi.fn(), cueVideoById: vi.fn(),
      }))
      singleControl.current = control
      useLayoutEffect(() => {
        coordinator.registerPlayer(control, 0)
        return () => { coordinator.unregisterPlayer(control) }
      }, [coordinator, control])
      return createElement('div', { className: 'single-player-layer' })
    },
  }
})

let position = 0
const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo')
beforeEach(() => {
  multiRenders.length = 0
  singleControl.current = null
  position = 0
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
    configurable: true,
    value: vi.fn(function (this: HTMLElement, options: ScrollToOptions) {
      position = (options.top ?? 0) / 600; this.scrollTop = options.top ?? 0
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

it('drives the one player from the shared gesture machinery, switching inside the gesture end', () => {
  const coordinator = new SinglePlaybackCoordinator()
  render(<VideoFeed videos={testVideos} coordinator={coordinator} playerMode="single" />)
  expect(multiRenders).toEqual([]) // No per-card player ever renders.
  const control = singleControl.current!
  act(() => coordinator.startFromGesture(0)) // The App start tap.
  expect(control.playVideo).toHaveBeenCalledOnce()
  const feed = screen.getByRole('main', { name: '動画フィード' })
  // The swipe moves below the settle threshold: no switch mid-scroll…
  position = 0.4; feed.scrollTop = 240
  fireEvent.scroll(feed)
  position = 0.55; feed.scrollTop = 330
  fireEvent.scroll(feed)
  expect(control.loadVideoById).not.toHaveBeenCalled()
  // …and the switch lands synchronously in the gesture-end turn.
  act(() => {
    fireEvent.pointerUp(window)
    expect(control.loadVideoById).toHaveBeenCalledOnce()
    expect(control.loadVideoById).toHaveBeenCalledWith(testVideos[1].externalVideoId)
  })
  // The settle afterwards issues no second switch for the same episode.
  position = 1; feed.scrollTop = 600
  act(() => { feed.dispatchEvent(new Event('scrollend')) })
  expect(control.loadVideoById).toHaveBeenCalledOnce()
})

it('switches inside the click when navigating with the buttons', () => {
  const coordinator = new SinglePlaybackCoordinator()
  render(<VideoFeed videos={testVideos} coordinator={coordinator} playerMode="single" />)
  const control = singleControl.current!
  act(() => coordinator.startFromGesture(0))
  control.loadVideoById.mockClear()
  act(() => {
    fireEvent.click(screen.getByRole('button', { name: '次へ ↓' }))
    expect(control.loadVideoById).toHaveBeenCalledOnce()
    expect(control.loadVideoById).toHaveBeenCalledWith(testVideos[1].externalVideoId)
  })
})
