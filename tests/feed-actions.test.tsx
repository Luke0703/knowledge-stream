import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { VideoFeed } from '../src/VideoFeed'
import { testVideos } from '../src/videos'

vi.mock('../src/player/YouTubePlayer', async () => {
  const { createElement } = await import('react')
  return { YouTubePlayer: () => createElement('div', { className: 'player-surface' }) }
})

let position = 0
const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo')
beforeEach(() => {
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

it('omits user actions without handler props', () => {
  render(<VideoFeed videos={testVideos} />)
  expect(screen.queryByRole('button', { name: '保存' })).toBeNull()
  expect(screen.queryByRole('button', { name: '興味なし' })).toBeNull()
})

it('reports save and not-interested actions with the current video and reflects saved state', () => {
  const onToggleSaved = vi.fn(), onNotInterested = vi.fn()
  const props = { videos: testVideos, onToggleSaved, onNotInterested }
  const view = render(<VideoFeed {...props} />)
  const save = screen.getByRole('button', { name: '保存' })
  expect(save.getAttribute('aria-pressed')).toBe('false')
  fireEvent.click(save)
  expect(onToggleSaved).toHaveBeenCalledExactlyOnceWith(testVideos[0])
  fireEvent.click(screen.getByRole('button', { name: '興味なし' }))
  expect(onNotInterested).toHaveBeenCalledExactlyOnceWith(testVideos[0])
  view.rerender(<VideoFeed {...props} savedVideoIds={new Set([testVideos[0].id])} />)
  expect(screen.getByRole('button', { name: '保存済み' }).getAttribute('aria-pressed')).toBe('true')
  view.rerender(<VideoFeed {...props} savedVideoIds={new Set()} />)
  expect(screen.getByRole('button', { name: '保存' }).getAttribute('aria-pressed')).toBe('false')
})

it('reports the settled active video once across a rerender with the same props', () => {
  const onActiveVideo = vi.fn()
  const props = { videos: testVideos, onActiveVideo }
  const view = render(<VideoFeed {...props} />)
  expect(onActiveVideo).toHaveBeenCalledExactlyOnceWith(testVideos[0].id)
  view.rerender(<VideoFeed {...props} />)
  expect(onActiveVideo).toHaveBeenCalledExactlyOnceWith(testVideos[0].id)
})

it('reports a new active item and resets reporting when the videos array changes', () => {
  const onActiveVideo = vi.fn()
  const view = render(<VideoFeed videos={testVideos} onActiveVideo={onActiveVideo} />)
  position = 1
  fireEvent.scroll(screen.getByRole('main', { name: '動画フィード' }))
  expect(onActiveVideo.mock.calls).toEqual([[testVideos[0].id], [testVideos[1].id]])
  view.rerender(<VideoFeed videos={[...testVideos]} onActiveVideo={onActiveVideo} />)
  expect(onActiveVideo.mock.calls).toEqual([[testVideos[0].id], [testVideos[1].id], [testVideos[1].id]])
})

it('omits feedback buttons without onFeedback even with other actions', () => {
  render(<VideoFeed videos={testVideos} onToggleSaved={vi.fn()} />)
  expect(screen.queryByRole('button', { name: /役立った/ })).toBeNull()
  expect(screen.queryByRole('button', { name: /分類が違う/ })).toBeNull()
})

it('reports each feedback type for the current video', () => {
  const onFeedback = vi.fn()
  render(<VideoFeed videos={testVideos} onFeedback={onFeedback} />)
  for (const label of ['役立った', '分類が違う']) {
    const button = screen.getByRole('button', { name: label })
    expect(button.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(button)
  }
  expect(onFeedback.mock.calls).toEqual([[testVideos[0], 'helpful'], [testVideos[0], 'wrong_category']])
})

it('marks sent feedback as pressed and disables repeat clicks', () => {
  const onFeedback = vi.fn()
  render(<VideoFeed videos={testVideos} onFeedback={onFeedback} feedbackSent={{ helpful: new Set([testVideos[0].id]), wrongCategory: new Set([testVideos[0].id]) }} />)
  for (const label of ['役立った ✓', '分類が違う ✓']) {
    const button = screen.getByRole('button', { name: label }) as HTMLButtonElement
    expect(button.getAttribute('aria-pressed')).toBe('true')
    expect(button.disabled).toBe(true)
    fireEvent.click(button)
  }
  expect(onFeedback).not.toHaveBeenCalled()
})
