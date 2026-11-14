import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SingleYouTubePlayer } from '../src/player/SingleYouTubePlayer'
import { SinglePlaybackCoordinator } from '../src/player/SinglePlaybackCoordinator'
import { testVideos } from '../src/videos'
import { loadYouTubeApi } from '../src/player/youtubeApi'

vi.mock('../src/player/youtubeApi', () => ({ loadYouTubeApi: vi.fn() }))
const instances: FakePlayer[] = []
class FakePlayer {
  options: YT.PlayerOptions
  iframe: HTMLIFrameElement
  pauseVideo = vi.fn()
  playVideo = vi.fn()
  stopVideo = vi.fn()
  cueVideoById = vi.fn()
  loadVideoById = vi.fn()
  mute = vi.fn()
  unMute = vi.fn()
  seekTo = vi.fn()
  destroy = vi.fn(() => { this.iframe.remove() })
  getIframe = () => this.iframe
  constructor(element: string | HTMLElement, options: YT.PlayerOptions) {
    this.options = options
    // The component pre-creates the iframe and hands over its id; the
    // fake adopts exactly that element, like the real API.
    this.iframe = (typeof element === 'string' ? document.getElementById(element) : element) as HTMLIFrameElement
    instances.push(this)
  }
  ready() { this.options.events?.onReady?.({ target: this as unknown as YT.Player }) }
}
beforeEach(() => {
  vi.useFakeTimers()
  instances.length = 0
  vi.mocked(loadYouTubeApi).mockResolvedValue({ Player: FakePlayer } as unknown as typeof YT)
})
afterEach(() => { cleanup(); vi.useRealTimers() })
const flush = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(150) }) }

const setup = () => {
  const coordinator = new SinglePlaybackCoordinator()
  coordinator.setVideos(testVideos)
  const view = render(<SingleYouTubePlayer videos={testVideos} coordinator={coordinator} />)
  return { coordinator, view }
}

it('creates exactly one player, adopting a hand-made iframe with the delegation attributes', async () => {
  const { coordinator } = setup()
  await flush()
  expect(instances).toHaveLength(1)
  const instance = instances[0]
  // The adopted iframe is the element the component pre-created in the page.
  expect(instance.iframe.isConnected).toBe(true)
  expect(instance.iframe.id).toBe('ks-single-player-0')
  expect(instance.iframe.src).toContain(`https://www.youtube.com/embed/${testVideos[0].externalVideoId}`)
  expect(instance.iframe.src).toContain('enablejsapi=1')
  expect(instance.iframe.getAttribute('allow')).toContain('autoplay')
  // The gate starts closed: the fresh iframe takes no touches.
  expect(instance.iframe.style.pointerEvents).toBe('none')
  act(() => instance.ready())
  expect(coordinator.isReady(0)).toBe(true)
})

it('switches the same player on commit and moves only the layer transform', async () => {
  const { coordinator, view } = setup()
  await flush()
  const instance = instances[0]
  act(() => instance.ready())
  act(() => coordinator.startFromGesture(0))
  expect(instance.playVideo).toHaveBeenCalledOnce()
  expect(instance.loadVideoById).not.toHaveBeenCalled()
  act(() => {
    coordinator.noteScrollStarted()
    coordinator.commitSwipeTarget(2)
  })
  expect(instances).toHaveLength(1) // Still the one persistent player.
  expect(instance.loadVideoById).toHaveBeenCalledOnce()
  expect(instance.loadVideoById).toHaveBeenCalledWith(testVideos[2].externalVideoId)
  const layer = view.container.querySelector('.single-player-layer') as HTMLElement
  expect(layer.style.transform).toBe('translateY(200%)')
  view.unmount()
  expect(instance.destroy).toHaveBeenCalledOnce()
  expect(document.querySelectorAll('iframe')).toHaveLength(0)
})

it('applies the gate to the single iframe as playback state changes', async () => {
  const { coordinator } = setup()
  await flush()
  const instance = instances[0]
  act(() => instance.ready())
  act(() => coordinator.startFromGesture(0))
  expect(instance.iframe.style.pointerEvents).toBe('none') // Not playing yet.
  act(() => instance.options.events?.onStateChange?.({ target: instance as unknown as YT.Player, data: 1 }))
  expect(instance.iframe.style.pointerEvents).toBe('auto') // Settled + playing: official UI usable.
  act(() => coordinator.noteScrollStarted())
  expect(instance.iframe.style.pointerEvents).toBe('none') // The next swipe closes it.
})
