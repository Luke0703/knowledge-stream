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
  unMute = vi.fn()
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

it('shows a slow-buffer recovery action without reloading automatically, and clears it on playback', async () => {
  vi.useFakeTimers()
  const coordinator = new PlaybackCoordinator()
  coordinator.setActive(0)
  render(<YouTubePlayer video={testVideos[0]} index={0} coordinator={coordinator} />)
  await flush()
  const instance = instances[0]
  act(() => instance.ready())
  const state = (data: number) => instance.options.events?.onStateChange?.({ target: instance as unknown as YT.Player, data })
  act(() => state(3))
  act(() => vi.advanceTimersByTime(6_000))
  act(() => state(3)) // Duplicate buffering events must not keep delaying the hint.
  act(() => vi.advanceTimersByTime(6_000))
  expect(screen.getByText(/読み込みが長引いて/)).toBeTruthy()
  expect(instance.destroy).not.toHaveBeenCalled()
  act(() => state(1))
  expect(screen.queryByRole('button', { name: '再読み込み' })).toBeNull()
  act(() => state(3))
  act(() => vi.advanceTimersByTime(12_000))
  fireEvent.click(screen.getByRole('button', { name: '再読み込み' }))
  await flush()
  expect(instance.destroy).toHaveBeenCalledOnce()
  expect(instances).toHaveLength(2)
})

it('clears buffer waits on pause and offers a guarded play action when autoplay is blocked', async () => {
  vi.useFakeTimers()
  const coordinator = new PlaybackCoordinator()
  coordinator.setActive(0)
  render(<YouTubePlayer video={testVideos[0]} index={0} coordinator={coordinator} />)
  await flush()
  const instance = instances[0]
  act(() => instance.ready())
  const state = (data: number) => instance.options.events?.onStateChange?.({ target: instance as unknown as YT.Player, data })
  act(() => state(3))
  act(() => state(2))
  act(() => vi.advanceTimersByTime(12_000))
  expect(screen.queryByRole('button', { name: '再読み込み' })).toBeNull()
  act(() => instance.options.events?.onAutoplayBlocked?.({ target: instance as unknown as YT.Player }))
  instance.playVideo.mockClear()
  fireEvent.click(screen.getByRole('button', { name: '再生する' }))
  expect(instance.playVideo).toHaveBeenCalledOnce()
  coordinator.setActive(null)
  fireEvent.click(screen.getByRole('button', { name: '再生する' }))
  expect(instance.playVideo).toHaveBeenCalledOnce()
})

it('destroys every iframe and clears timers over repeated ready and not-yet-ready unmounts', async () => {
  vi.useFakeTimers()
  const coordinator = new PlaybackCoordinator()
  coordinator.setActive(0)
  for (let cycle = 0; cycle < 50; cycle++) {
    const view = render(<YouTubePlayer video={testVideos[0]} index={0} coordinator={coordinator} />)
    await flush()
    const instance = instances[cycle]
    if (cycle % 2 === 0) {
      act(() => instance.ready())
      act(() => instance.options.events?.onStateChange?.({ target: instance as unknown as YT.Player, data: 3 }))
    }
    view.unmount()
    expect(instance.destroy).toHaveBeenCalledOnce()
    expect(document.querySelectorAll('iframe')).toHaveLength(0)
    expect(vi.getTimerCount()).toBe(0)
    const starts = instance.playVideo.mock.calls.length
    // Late YouTube callbacks must not re-register a destroyed player.
    act(() => instance.ready())
    coordinator.play(0)
    expect(instance.playVideo).toHaveBeenCalledTimes(starts)
  }
})
