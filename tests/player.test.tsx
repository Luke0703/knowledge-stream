import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { YouTubePlayer } from '../src/player/YouTubePlayer'
import { PlaybackCoordinator } from '../src/player/PlaybackCoordinator'
import { testVideos } from '../src/videos'
import { loadYouTubeApi } from '../src/player/youtubeApi'

vi.mock('../src/player/youtubeApi', () => ({ loadYouTubeApi: vi.fn() }))
const instances: FakePlayer[] = []
class FakePlayer {
  options: YT.PlayerOptions
  iframe = document.createElement('iframe')
  pauseVideo = vi.fn()
  playVideo = vi.fn()
  mute = vi.fn()
  destroy = vi.fn(() => {
    expect(this.iframe.isConnected).toBe(true)
    this.iframe.remove()
  })
  getIframe = () => this.iframe
  constructor(element: HTMLElement, options: YT.PlayerOptions) {
    this.options = options; element.replaceWith(this.iframe); instances.push(this)
  }
  ready() { this.options.events?.onReady?.({ target: this as unknown as YT.Player }) }
}
beforeEach(() => {
  instances.length = 0
  vi.mocked(loadYouTubeApi).mockResolvedValue({ Player: FakePlayer } as unknown as typeof YT)
})
afterEach(() => { cleanup(); vi.useRealTimers() })
const flush = async () => { await act(async () => { await Promise.resolve() }) }

it('cleans up StrictMode async initialization and ignores ready after unmount', async () => {
  const coordinator = new PlaybackCoordinator()
  coordinator.setActive(0)
  const view = render(<StrictMode><YouTubePlayer video={testVideos[0]} index={0} coordinator={coordinator} /></StrictMode>)
  await flush()
  expect(instances).toHaveLength(1)
  const instance = instances[0]
  act(() => instance.ready())
  expect(instance.playVideo).toHaveBeenCalledOnce()
  view.unmount()
  expect(instance.pauseVideo).toHaveBeenCalledOnce()
  expect(instance.destroy).toHaveBeenCalledOnce()
  act(() => instance.ready())
  expect(instance.playVideo).toHaveBeenCalledOnce()
})

it('shows autoplay guidance separately from errors and retries by destroying the old iframe', async () => {
  render(<YouTubePlayer video={testVideos[0]} index={0} coordinator={new PlaybackCoordinator()} />)
  await flush()
  const instance = instances[0]
  act(() => instance.ready())
  act(() => instance.options.events?.onAutoplayBlocked?.({ target: instance as unknown as YT.Player }))
  expect(screen.getByText(/自動再生が制限/)).toBeTruthy()
  expect(screen.queryByRole('button', { name: '再試行' })).toBeNull()
  act(() => instance.options.events?.onError?.({ target: instance as unknown as YT.Player, data: 150 }))
  expect(screen.getByText(/埋め込み再生が許可/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '再試行' }))
  await flush()
  expect(instance.destroy).toHaveBeenCalledOnce()
  expect(instances).toHaveLength(2)
})

it('offers retry for script failure and player readiness timeout', async () => {
  vi.useFakeTimers()
  vi.mocked(loadYouTubeApi).mockRejectedValueOnce(new Error('offline'))
  render(<YouTubePlayer video={testVideos[0]} index={0} coordinator={new PlaybackCoordinator()} />)
  await flush()
  expect(screen.getByText(/YouTubeを読み込めません/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '再試行' }))
  await flush()
  act(() => vi.advanceTimersByTime(15_000))
  expect(screen.getByText(/プレーヤーの応答がありません/)).toBeTruthy()
})
