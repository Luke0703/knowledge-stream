import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import App from '../src/App'

vi.mock('../src/VideoFeed', () => ({
  VideoFeed: () => <main aria-label="動画フィード">フィード表示中</main>,
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
