import { useEffect, useState } from 'react'
import type { HealthResponse } from '../shared/api'
import { testVideos } from './videos'
import { VideoFeed } from './VideoFeed'
import { PlaybackCoordinator } from './player/PlaybackCoordinator'
import { SinglePlaybackCoordinator } from './player/SinglePlaybackCoordinator'
import type { FeedCoordinator } from './player/FeedCoordinator'
import { isDiagnosticsEnabled, startDiagnostics } from './player/diagnostics'
import { DiagnosticsPanel } from './player/DiagnosticsPanel'

export default function App() {
  useEffect(startDiagnostics, [])
  // Round 10 A/B flag: ?player=single selects the single-persistent-
  // player core; anything else keeps the per-card core as the default,
  // so one preview deploy serves both modes for device comparison.
  const [playerMode] = useState<'multi' | 'single'>(() =>
    new URLSearchParams(window.location.search).get('player') === 'single' ? 'single' : 'multi')
  // The coordinator lives here, not in the feed, so App can hold playback
  // during preparation and release it from the decisive start tap.
  const [coordinator] = useState<FeedCoordinator>(() => {
    const created = playerMode === 'single' ? new SinglePlaybackCoordinator() : new PlaybackCoordinator()
    created.setHeld(true)
    return created
  })
  // Start flow, round 3 (2026-11-10; user-approved start gate 2026-11-08,
  // two-phase revision after real-device results): rounds 1-2 mounted the
  // feed only AFTER the start tap, so the first play request was issued
  // seconds later from an async onReady chain and Safari's transient
  // activation from the tap had already expired; stamping the tap and
  // retrying inside a time window did not restore it (verified unchanged
  // on a real iPhone in both Brave and Safari). Now the feed is mounted
  // behind the start screen from the beginning — concealed with
  // display:none, never overlaid on a player — while the coordinator is
  // held, so players are created and cued but no play is requested and
  // no autoplay block is generated. Once the first player reports ready,
  // the start button enables, and its click handler calls
  // coordinator.startFromGesture(0) synchronously, sending unMute +
  // playVideo to the already-ready player inside the tap itself.
  const [started, setStarted] = useState(false)
  const [firstReady, setFirstReady] = useState(false)
  useEffect(() => {
    const update = () => setFirstReady(coordinator.isReady(0))
    update()
    return coordinator.subscribeReady(update)
  }, [coordinator])
  const begin = () => {
    // Synchronous inside this click handler: the play request (when the
    // player is ready) leaves before the feed is even revealed.
    coordinator.startFromGesture(0)
    setStarted(true)
  }
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
    <header className="app-header"><div><p className="eyebrow">SHORTS SPIKE · PHASE 1.5</p><h1>Knowledge Stream<span> / 知るを、つなぐ。</span></h1></div><span className="api-status">{playerMode === 'single' && '単一プレーヤー · '}{!preloadAdjacent && '先読みオフ · '}{apiStatus}</span></header>
    {!started && <main className="start-screen">
      <p className="start-title">タップして動画をはじめる</p>
      <p>ブラウザの仕組み上、音声つきの再生には最初のタップが必要です。まず裏でプレーヤーを準備し、準備ができた瞬間のタップから直接再生を始めます。</p>
      <button className="start-button" disabled={!firstReady} onClick={begin}>{firstReady ? '▶ タップして開始' : 'プレーヤーを準備中…'}</button>
      {!firstReady && <button className="start-skip" onClick={begin}>準備を待たずに表示する</button>}
    </main>}
    <div className={started ? 'feed-host feed-host--started' : 'feed-host feed-host--preparing'}>
      <VideoFeed videos={testVideos} preloadAdjacent={preloadAdjacent} coordinator={coordinator} playerMode={playerMode} />
    </div>
    {isDiagnosticsEnabled && <DiagnosticsPanel />}
    <nav className="bottom-nav" aria-label="メインナビゲーション">
      <button aria-current="page">▶ <span>動画</span></button>
      <button disabled>⌕ <span>検索</span><small>準備中</small></button>
      <button disabled>◎ <span>プロフィール</span><small>準備中</small></button>
    </nav>
  </div>
}
