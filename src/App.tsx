import { useEffect, useState } from 'react'
import type { HealthResponse, SearchVideoDto } from '../shared/api'
import { testVideos } from './videos'
import { VideoFeed } from './VideoFeed'
import { SearchView } from './SearchView'
import { PlaybackCoordinator } from './player/PlaybackCoordinator'
import { SinglePlaybackCoordinator } from './player/SinglePlaybackCoordinator'
import type { FeedCoordinator } from './player/FeedCoordinator'
import { isDiagnosticsEnabled, startDiagnostics } from './player/diagnostics'
import { DiagnosticsPanel } from './player/DiagnosticsPanel'

type Tab = 'videos' | 'search' | 'profile'

export default function App() {
  useEffect(startDiagnostics, [])
  // Player core selection (round 10 A/B, resolved 2026-11-16): the
  // single-persistent-player core is the DEFAULT — rounds 10/11 passed
  // their iPhone device checks (swipe landings play with sound; one tap
  // toggles play/pause). ?player=multi remains as the escape hatch back
  // to the per-card core (rounds 1–9 architecture) on the same deploy.
  const [playerMode] = useState<'multi' | 'single'>(() =>
    new URLSearchParams(window.location.search).get('player') === 'multi' ? 'multi' : 'single')
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
  const [tab, setTab] = useState<Tab>('videos')
  // A search result tap asks the feed to open that video (matched by the
  // YouTube external id). The nonce retriggers the request for repeat taps.
  const [openRequest, setOpenRequest] = useState<{ externalVideoId: string; nonce: number } | null>(null)
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

  // Leaving the video tab pauses the current video (the feed stays
  // mounted and concealed — the single player must never unmount);
  // returning lets the feed's own measurement resume the settled item.
  useEffect(() => {
    if (tab !== 'videos') coordinator.setActive(null)
  }, [tab, coordinator])

  const openVideo = (video: SearchVideoDto) => {
    const index = testVideos.findIndex(item => item.externalVideoId === video.externalVideoId)
    if (!started && index >= 0) {
      // The result tap is itself a genuine gesture: when playback has
      // not started yet, treat it as the decisive start tap for that
      // video — synchronously inside this handler, exactly like the
      // start button does for the first video. A result that is not in
      // the feed only switches tabs (the search branch's behaviour).
      coordinator.startFromGesture(index)
      setStarted(true)
    }
    setOpenRequest({ externalVideoId: video.externalVideoId, nonce: Date.now() })
    setTab('videos')
  }

  return <div className="app-shell">
    <header className="app-header"><div><p className="eyebrow">SHORTS SPIKE · PHASE 1.5</p><h1>Knowledge Stream<span> / 知るを、つなぐ。</span></h1></div><span className="api-status">{playerMode === 'single' && '単一プレーヤー · '}{!preloadAdjacent && '先読みオフ · '}{apiStatus}</span></header>
    {tab === 'videos' && !started && <main className="start-screen">
      <p className="start-title">タップして動画をはじめる</p>
      <p>ブラウザの仕組み上、音声つきの再生には最初のタップが必要です。まず裏でプレーヤーを準備し、準備ができた瞬間のタップから直接再生を始めます。</p>
      <button className="start-button" disabled={!firstReady} onClick={begin}>{firstReady ? '▶ タップして開始' : 'プレーヤーを準備中…'}</button>
      {!firstReady && <button className="start-skip" onClick={begin}>準備を待たずに表示する</button>}
    </main>}
    <div className={tab !== 'videos' ? 'feed-host feed-host--tab-hidden' : started ? 'feed-host feed-host--started' : 'feed-host feed-host--preparing'}>
      <VideoFeed videos={testVideos} preloadAdjacent={preloadAdjacent} coordinator={coordinator} playerMode={playerMode} focusExternalVideoId={openRequest?.externalVideoId} focusNonce={openRequest?.nonce} />
    </div>
    {tab === 'search' && <SearchView onOpenVideo={openVideo} />}
    {tab === 'profile' && <main className="profile-placeholder" aria-label="プロフィール（設定）">
      <h2>プロフィール（設定）</h2>
      <p>ジャンル選択・保存・端末内データ管理（SPEC 2.5）は今後の実装です。このタブは配置のみで、機能はまだありません。</p>
    </main>}
    {isDiagnosticsEnabled && <DiagnosticsPanel />}
    <nav className="bottom-nav" aria-label="メインナビゲーション">
      <button aria-current={tab === 'videos' ? 'page' : undefined} onClick={() => setTab('videos')}>▶ <span>動画</span></button>
      <button aria-current={tab === 'search' ? 'page' : undefined} onClick={() => setTab('search')}>⌕ <span>検索</span></button>
      <button aria-current={tab === 'profile' ? 'page' : undefined} onClick={() => setTab('profile')}>◎ <span>プロフィール</span></button>
    </nav>
  </div>
}
