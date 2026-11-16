import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import App from '../src/App'
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

beforeEach(() => {
  capturedCoordinator = undefined
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
    ok: true, json: () => Promise.resolve({ ok: true, phase: 1 }),
  })))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.history.pushState({}, '', '/')
})

it('prepares the feed concealed behind the start screen, and the start button accepts taps during preparation', () => {
  render(<App />)
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

it('sends the first play request synchronously from the decisive tap to the already-ready player', () => {
  render(<App />)
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

it('fires the latched start at registration when the decisive tap lands during preparation, with no second tap', () => {
  render(<App />)
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

it('does not render the on-screen diagnostics panel even with ?diagnostics=1', () => {
  // Kazuki's 2026-11-17 request: the diagnostics log strip at the
  // bottom of the screen goes away for good. The internal event
  // recording stays; the panel UI must not appear, flag or not.
  window.history.pushState({}, '', '/?diagnostics=1')
  render(<App />)
  expect(screen.queryByTestId('diagnostics-panel')).toBeNull()
  expect(screen.queryByLabelText('プレーヤー診断ログ')).toBeNull()
})

it('keeps the per-card core behind ?player=multi as an escape hatch', () => {
  window.history.pushState({}, '', '/?player=multi')
  render(<App />)
  expect(capturedCoordinator).toBeInstanceOf(PlaybackCoordinator)
  expect(capturedCoordinator).not.toBeInstanceOf(SinglePlaybackCoordinator)
})
