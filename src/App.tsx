import { useEffect, useState } from 'react'
import type { HealthResponse } from '../shared/api'
import { testVideos } from './videos'
import { VideoFeed } from './VideoFeed'
import { PlaybackCoordinator } from './player/PlaybackCoordinator'
import { startDiagnostics } from './player/diagnostics'

export default function App() {
  useEffect(startDiagnostics, [])
  // The coordinator lives here, not in the feed, so the start tap itself
  // can be stamped as a genuine gesture before the feed (and its players)
  // exist. Safari needs this: its activation from the tap fades fast, and
  // the first player's block lands only after the player becomes ready.
  const [coordinator] = useState(() => new PlaybackCoordinator())
  // Start gate (user-approved 2026-11-08): browsers only allow sound-on
  // playback inside a genuine user gesture, so the feed is not mounted
  // until the user taps start. That single real tap is what lets the first
  // video begin with sound, reel-app style. Nothing is overlaid on the
  // player: before the tap there is no player on screen at all.
  const [started, setStarted] = useState(false)
  // Opt-in comparison for the iPhone slowdown investigation; no saved setting.
  const [preloadAdjacent] = useState(() => new URLSearchParams(window.location.search).get('preload') !== 'off')
  const [apiStatus, setApiStatus] = useState('API 接続中')
  useEffect(() => {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 8_000)
    let mounted = true
    void fetch('/api/v1/health', { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('API unavailable')
      const body: HealthResponse = await response.json()
      if (mounted) setApiStatus(body.ok && body.phase === 1 ? 'API 接続済み' : 'API 応答エラー')
    }).catch(() => { if (mounted) setApiStatus('API 未接続（動画操作は利用可能）') })
      .finally(() => clearTimeout(timeout))
    return () => { mounted = false; clearTimeout(timeout); controller.abort() }
  }, [])

  return <div className="app-shell">
    <header className="app-header"><div><p className="eyebrow">SHORTS SPIKE · PHASE 1.5</p><h1>Knowledge Stream<span> / 知るを、つなぐ。</span></h1></div><span className="api-status">{!preloadAdjacent && '先読みオフ · '}{apiStatus}</span></header>
    {started
      ? <VideoFeed videos={testVideos} preloadAdjacent={preloadAdjacent} coordinator={coordinator} />
      : <main className="start-screen">
          <p className="start-title">タップして動画をはじめる</p>
          <p>ブラウザの仕組み上、音声つきの再生には最初のタップが必要です。開始をタップすると、1本目から音声つきで再生が始まります。</p>
          <button className="start-button" onPointerDown={() => coordinator.noteUserGesture()} onClick={() => setStarted(true)}>▶ タップして開始</button>
        </main>}
    <nav className="bottom-nav" aria-label="メインナビゲーション">
      <button aria-current="page">▶ <span>動画</span></button>
      <button disabled>⌕ <span>検索</span><small>準備中</small></button>
      <button disabled>◎ <span>プロフィール</span><small>準備中</small></button>
    </nav>
  </div>
}
