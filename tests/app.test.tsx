import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import App from '../src/App'
import { emptyClientState, loadClientState, saveClientState } from '../src/state/clientState'
import { testVideos } from '../src/videos'
import type { FeedCoordinator } from '../src/player/FeedCoordinator'
import { PlaybackCoordinator } from '../src/player/PlaybackCoordinator'
import { SinglePlaybackCoordinator } from '../src/player/SinglePlaybackCoordinator'

let capturedCoordinator: FeedCoordinator | undefined
vi.mock('../src/VideoFeed', () => ({
  VideoFeed: (props: { coordinator?: FeedCoordinator }) => {
    capturedCoordinator = props.coordinator
    return <main aria-label="動画フィード">フィード表示中</main>
  },
}))

const fakePlayer = () => ({
  pauseVideo: vi.fn(), playVideo: vi.fn(), mute: vi.fn(), unMute: vi.fn(), seekTo: vi.fn(),
  loadVideoById: vi.fn(), cueVideoById: vi.fn(),
})

const categories = [{ id: 'cat-math', name: '数学' }, { id: 'cat-mono', name: 'ものづくり' }, { id: 'cat-phys', name: '物理' }]
const fetchResponse = (url: string) => ({
  ok: true,
  json: async () => url.startsWith('/api/v1/categories') ? { categories }
    : url.startsWith('/api/v1/feed') ? { categories: [], limit: 50, results: testVideos.map(video => ({ ...video, platform: 'youtube' })) }
    : { ok: true, phase: 1 },
})
beforeEach(() => {
  capturedCoordinator = undefined
  window.localStorage.clear()
  saveClientState({ ...emptyClientState(), selectedCategoryIds: ['cat-math', 'cat-mono', 'cat-phys'] })
  vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve(fetchResponse(url))))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.history.pushState({}, '', '/')
})

it('prepares the feed concealed behind the start screen, and the start button accepts taps during preparation', async () => {
  render(<App />)
  await screen.findByRole('button', { name: /タップして開始/ })
  // Round 3: the feed IS mounted from the beginning (so its players can
  // become ready before the decisive tap), but concealed as a separate
  // screen — the host carries the preparing class (display:none in CSS),
  // nothing is overlaid on a player, and playback is held.
  const host = screen.getByLabelText('動画フィード').closest('.feed-host')
  expect(host?.classList.contains('feed-host--preparing')).toBe(true)
  expect(capturedCoordinator?.isHeld()).toBe(true)
  // Round 12: the button is NOT disabled while the player prepares.
  // It used to be disabled until the first player was ready, which
  // discarded the user's first press entirely (a real browser never
  // delivers a click on a disabled button) and forced the second
  // press Kazuki reported on device 2026-11-17.
  const startButton = screen.getByRole('button', { name: /タップして開始/ })
  expect((startButton as HTMLButtonElement).disabled).toBe(false)
})

it('sends the first play request synchronously from the decisive tap to the already-ready player', async () => {
  render(<App />)
  await screen.findByRole('button', { name: /タップして開始/ })
  // Since 2026-11-16 the default core is the single persistent player;
  // the mocked feed's part of registration is played by the test: hand
  // over the video list (VideoFeed calls setVideos on mount) and
  // register the one player at the first video.
  const coordinator = capturedCoordinator as SinglePlaybackCoordinator
  expect(coordinator).toBeInstanceOf(SinglePlaybackCoordinator)
  const first = fakePlayer()
  act(() => { coordinator.setVideos(testVideos); coordinator.registerPlayer(first, 0) })
  // Held during preparation: becoming ready must not request playback.
  expect(first.playVideo).not.toHaveBeenCalled()
  const startButton = screen.getByRole('button', { name: /タップして開始/ })
  expect((startButton as HTMLButtonElement).disabled).toBe(false)
  fireEvent.pointerDown(startButton)
  fireEvent.click(startButton)
  // The request left inside the tap itself, sound on first.
  expect(first.unMute).toHaveBeenCalledOnce()
  expect(first.playVideo).toHaveBeenCalledOnce()
  expect(first.unMute.mock.invocationCallOrder[0]).toBeLessThan(first.playVideo.mock.invocationCallOrder[0])
  // And the feed screen is now the visible one.
  expect(screen.queryByRole('button', { name: /タップして開始/ })).toBeNull()
  const host = screen.getByLabelText('動画フィード').closest('.feed-host')
  expect(host?.classList.contains('feed-host--started')).toBe(true)
})

it('fires the latched start at registration when the decisive tap lands during preparation, with no second tap', async () => {
  render(<App />)
  await screen.findByRole('button', { name: /タップして開始/ })
  // Round 12: the decisive tap lands while the player is still being
  // constructed. It must be latched — not discarded — and the start
  // must fire when the player registers, without another tap.
  fireEvent.click(screen.getByRole('button', { name: /タップして開始/ }))
  expect(screen.queryByRole('button', { name: /タップして開始/ })).toBeNull()
  expect(capturedCoordinator?.isHeld()).toBe(false)
  expect(capturedCoordinator?.canPlay(0)).toBe(true)
  const host = screen.getByLabelText('動画フィード').closest('.feed-host')
  expect(host?.classList.contains('feed-host--started')).toBe(true)
  // The mocked feed's part of registration, played by the test: hand
  // over the video list and register the one player at the first video.
  const coordinator = capturedCoordinator as SinglePlaybackCoordinator
  const first = fakePlayer()
  act(() => { coordinator.setVideos(testVideos); coordinator.registerPlayer(first, 0) })
  expect(first.unMute).toHaveBeenCalledOnce()
  expect(first.playVideo).toHaveBeenCalledOnce()
})

it('does not render the on-screen diagnostics panel even with ?diagnostics=1', async () => {
  // Kazuki's 2026-11-17 request: the diagnostics log strip at the
  // bottom of the screen goes away for good. The internal event
  // recording stays; the panel UI must not appear, flag or not.
  window.history.pushState({}, '', '/?diagnostics=1')
  render(<App />)
  await screen.findByRole('button', { name: /タップして開始/ })
  expect(screen.queryByTestId('diagnostics-panel')).toBeNull()
  expect(screen.queryByLabelText('プレーヤー診断ログ')).toBeNull()
})

it('keeps the per-card core behind ?player=multi as an escape hatch', async () => {
  window.history.pushState({}, '', '/?player=multi')
  render(<App />)
  await screen.findByRole('button', { name: /タップして開始/ })
  expect(capturedCoordinator).toBeInstanceOf(PlaybackCoordinator)
  expect(capturedCoordinator).not.toBeInstanceOf(SinglePlaybackCoordinator)
})

it('requires a first-run genre and persists the selection before preparing the feed', async () => {
  window.localStorage.clear()
  render(<App />)
  await screen.findByRole('heading', { name: 'ジャンルを選んでください' })
  expect(screen.queryByRole('button', { name: /タップして開始/ })).toBeNull()
  const submit = screen.getByRole('button', { name: 'このジャンルではじめる' })
  expect((submit as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(screen.getByRole('checkbox', { name: '数学' }))
  expect((submit as HTMLButtonElement).disabled).toBe(false)
  fireEvent.click(submit)
  await screen.findByRole('button', { name: /タップして開始/ })
  expect(loadClientState().selectedCategoryIds).toEqual(['cat-math'])
})

it('retries a failed feed request', async () => {
  vi.stubGlobal('fetch', vi.fn((url: string) => url.startsWith('/api/v1/feed') ? Promise.reject(new Error('offline')) : Promise.resolve(fetchResponse(url))))
  render(<App />)
  await screen.findByText('動画の読み込みに失敗しました')
  vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve(fetchResponse(url))))
  fireEvent.click(screen.getByRole('button', { name: '再試行' }))
  await screen.findByRole('button', { name: /タップして開始/ })
})
