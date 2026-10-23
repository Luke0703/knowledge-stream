import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { VideoFeed } from '../src/VideoFeed'
import { testVideos } from '../src/videos'
import type { PlaybackCoordinator, PlayerControl } from '../src/player/PlaybackCoordinator'

const players = vi.hoisted(() => new Map<number, PlayerControl>())
vi.mock('../src/player/YouTubePlayer', async () => {
  const { createElement, useLayoutEffect } = await import('react')
  return { YouTubePlayer: ({ index, coordinator }: { index: number; coordinator: PlaybackCoordinator }) => {
    useLayoutEffect(() => {
      const player = { pauseVideo: vi.fn(), playVideo: vi.fn(), mute: vi.fn(), unMute: vi.fn() }
      players.set(index, player)
      coordinator.register(index, player)
      return () => coordinator.unregister(index, player)
    }, [index, coordinator])
    return createElement('div', { className: 'player-surface' })
  } }
})

let position = 0
let scrollWorks = true
const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')
beforeEach(() => {
  players.clear(); position = 0; scrollWorks = true
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(function (this: HTMLElement) {
      if (scrollWorks) position = Array.from(this.parentElement!.children).indexOf(this)
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
  if (originalScroll) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScroll)
  else delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView
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
