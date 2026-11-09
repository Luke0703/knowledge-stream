import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import App from '../src/App'
import type { PlaybackCoordinator } from '../src/player/PlaybackCoordinator'

let capturedCoordinator: PlaybackCoordinator | undefined
vi.mock('../src/VideoFeed', () => ({
  VideoFeed: (props: { coordinator?: PlaybackCoordinator }) => {
    capturedCoordinator = props.coordinator
    return <main aria-label="動画フィード">フィード表示中</main>
  },
}))

const fakePlayer = () => ({ pauseVideo: vi.fn(), playVideo: vi.fn(), mute: vi.fn(), unMute: vi.fn() })

beforeEach(() => {
  capturedCoordinator = undefined
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
    ok: true, json: () => Promise.resolve({ ok: true, phase: 1 }),
  })))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('prepares the feed concealed behind the start screen, with the start button disabled until the first player is ready', () => {
  render(<App />)
  // Round 3: the feed IS mounted from the beginning (so its players can
  // become ready before the decisive tap), but concealed as a separate
  // screen — the host carries the preparing class (display:none in CSS),
  // nothing is overlaid on a player, and playback is held.
  const host = screen.getByLabelText('動画フィード').closest('.feed-host')
  expect(host?.classList.contains('feed-host--preparing')).toBe(true)
  expect(capturedCoordinator?.isHeld()).toBe(true)
  const startButton = screen.getByRole('button', { name: /プレーヤーを準備中/ })
  expect((startButton as HTMLButtonElement).disabled).toBe(true)
})

it('sends the first play request synchronously from the decisive tap to the already-ready player', () => {
  render(<App />)
  const coordinator = capturedCoordinator!
  const first = fakePlayer()
  act(() => { coordinator.register(0, first) })
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

it('lets the user proceed without waiting for readiness, arming the first video instead of stranding them', () => {
  render(<App />)
  fireEvent.click(screen.getByRole('button', { name: /準備を待たずに表示する/ }))
  expect(screen.queryByRole('button', { name: /プレーヤーを準備中/ })).toBeNull()
  expect(capturedCoordinator?.isHeld()).toBe(false)
  expect(capturedCoordinator?.canPlay(0)).toBe(true)
  const host = screen.getByLabelText('動画フィード').closest('.feed-host')
  expect(host?.classList.contains('feed-host--started')).toBe(true)
})
