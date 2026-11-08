import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
    ok: true, json: () => Promise.resolve({ ok: true, phase: 1 }),
  })))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('shows the start screen first and mounts the feed only after the start tap', () => {
  render(<App />)
  // No feed (and therefore no player) exists before the genuine start tap.
  expect(screen.queryByLabelText('動画フィード')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: /タップして開始/ }))
  expect(screen.getByLabelText('動画フィード')).toBeTruthy()
  expect(screen.queryByRole('button', { name: /タップして開始/ })).toBeNull()
})

it('stamps the start tap as a genuine gesture on the shared coordinator before the feed mounts', () => {
  capturedCoordinator = undefined
  render(<App />)
  const startButton = screen.getByRole('button', { name: /タップして開始/ })
  fireEvent.pointerDown(startButton)
  fireEvent.click(startButton)
  // The feed received App's coordinator, and the tap reached it before the
  // feed existed, so the first player's later block can use that gesture.
  expect(capturedCoordinator).toBeTruthy()
  const stamp = (capturedCoordinator as unknown as { lastGestureAt: number }).lastGestureAt
  expect(stamp).not.toBe(Number.NEGATIVE_INFINITY)
})
