import { submitFeedback } from './feedback/submitFeedback'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CategoriesResponse, CategoryDto, FeedbackType, FeedResponse, HealthResponse, SearchVideoDto } from '../shared/api'
import { feedVideoFromDto, type FeedVideo } from './feed/model'
import { orderFeedVideos } from './feed/order'
import { hasFeedbackSent, withClientId, withFeedbackSent, emptyClientState, loadClientState, saveClientState, withSelectedCategoryIds, withViewed, withSavedToggled, withNotInterested, withoutViewed, withoutSaved, withoutNotInterested } from './state/clientState'
import { GenreSelectScreen } from './GenreSelect'
import { ProfileView } from './ProfileView'
import { GuideView } from './GuideView'
import { VideoFeed } from './VideoFeed'
import { SearchView } from './SearchView'
import { PlaybackCoordinator } from './player/PlaybackCoordinator'
import { SinglePlaybackCoordinator } from './player/SinglePlaybackCoordinator'
import type { FeedCoordinator } from './player/FeedCoordinator'
import { startDiagnostics } from './player/diagnostics'

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
  // the start button's click handler calls
  // coordinator.startFromGesture(0) synchronously, sending unMute +
  // playVideo to the already-ready player inside the tap itself.
  //
  // Round 12 (2026-11-17): the button used to stay DISABLED until the
  // first player reported ready. On a real phone the YouTube API +
  // player construction takes long enough that the user's first press
  // lands in that window — and a disabled button discards the press
  // entirely, so only the second press started playback (Kazuki's
  // device report). The button now accepts the tap at any time:
  // startFromGesture latches the intent in the coordinator (the
  // pending switch), and registerPlayer issues the start the moment
  // the player becomes ready — no second tap, and no muted substitute
  // start anywhere in the path.
  const [started, setStarted] = useState(false)
  const begin = () => {
    // Synchronous inside this click handler: when the player is
    // already ready, the play request leaves before the feed is even
    // revealed; when it is not, the coordinator's latch fires it at
    // registration instead.
    coordinator.startFromGesture(0)
    setStarted(true)
  }
  // Opt-in comparison for the iPhone slowdown investigation; no saved setting.
  const [preloadAdjacent] = useState(() => new URLSearchParams(window.location.search).get('preload') !== 'off')
  const [apiStatus, setApiStatus] = useState('API 接続中')
  const [tab, setTab] = useState<Tab>('videos')
  const [guideOpen, setGuideOpen] = useState(false)
  const selectTab = (nextTab: Tab) => {
    setGuideOpen(false)
    setTab(nextTab)
  }
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

  const [clientState, setClientState] = useState(() => loadClientState())
  const clientRef = useRef(clientState)
  clientRef.current = clientState
  useEffect(() => saveClientState(clientState), [clientState])
  const selection = clientState.selectedCategoryIds
  const selectionKey = selection ? selection.join(',') : null
  const [categories, setCategories] = useState<{ status: 'loading' | 'error' | 'ready'; list: CategoryDto[] }>({ status: 'loading', list: [] })
  const [categoriesRetry, setCategoriesRetry] = useState(0)
  const [feed, setFeed] = useState<{ status: 'loading' | 'error' | 'ready'; candidates: FeedVideo[] }>({ status: 'loading', candidates: [] })
  const [feedRetry, setFeedRetry] = useState(0)
  const [orderedBase, setOrderedBase] = useState<FeedVideo[]>([])
  const [orderNonce, setOrderNonce] = useState(0)
  const [sessionAdded, setSessionAdded] = useState<FeedVideo[]>([])
  const [prepended, setPrepended] = useState<FeedVideo | null>(null)
  const [feedKey, setFeedKey] = useState(0)
  const [reselecting, setReselecting] = useState(false)
  const catalog = useRef(new Map<string, FeedVideo>())
  const [catalogVersion, setCatalogVersion] = useState(0)
  const catalogFetched = useRef(false)
  const mergeCatalog = useCallback((videos: FeedVideo[]) => {
    let added = false
    for (const video of videos) {
      if (!catalog.current.has(video.id)) added = true
      catalog.current.set(video.id, video)
    }
    if (added) setCatalogVersion(version => version + 1)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 8_000)
    let mounted = true
    setCategories(previous => ({ ...previous, status: 'loading' }))
    void fetch('/api/v1/categories', { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('Categories unavailable')
      const body: CategoriesResponse = await response.json()
      if (mounted) setCategories({ status: 'ready', list: body.categories })
    }).catch(() => { if (mounted) setCategories({ status: 'error', list: [] }) })
      .finally(() => clearTimeout(timeout))
    return () => { mounted = false; clearTimeout(timeout); controller.abort() }
  }, [categoriesRetry])

  useEffect(() => {
    if (selectionKey === null) { setFeed({ status: 'loading', candidates: [] }); return }
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 8_000)
    let mounted = true
    setFeed({ status: 'loading', candidates: [] })
    const ids = clientRef.current.selectedCategoryIds ?? []
    void fetch(`/api/v1/feed?categories=${ids.map(encodeURIComponent).join(',')}&limit=50`, { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('Feed unavailable')
      const body: FeedResponse = await response.json()
      if (mounted) {
        const candidates = body.results.map(feedVideoFromDto)
        mergeCatalog(candidates)
        setFeed({ status: 'ready', candidates })
      }
    }).catch(() => { if (mounted) setFeed({ status: 'error', candidates: [] }) })
      .finally(() => clearTimeout(timeout))
    return () => { mounted = false; clearTimeout(timeout); controller.abort() }
  }, [selectionKey, feedRetry, mergeCatalog])

  useEffect(() => {
    // Snapshot history only at ordering time; active-item updates must not reshuffle playback.
    if (feed.status === 'ready') setOrderedBase(orderFeedVideos(feed.candidates, {
      viewedIds: new Set(clientRef.current.viewedVideoIds),
      notInterestedIds: new Set(clientRef.current.notInterestedVideoIds),
    }))
  }, [feed.status, feed.candidates, selectionKey, orderNonce])

  useEffect(() => {
    if (tab !== 'profile' || catalogFetched.current || !clientRef.current.savedVideoIds.some(id => !catalog.current.has(id))) return
    catalogFetched.current = true
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 8_000)
    let mounted = true
    void fetch('/api/v1/feed?limit=50', { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('Catalog unavailable')
      const body: FeedResponse = await response.json()
      if (mounted) mergeCatalog(body.results.map(feedVideoFromDto))
    }).catch(() => { /* Unresolved saves remain visible as a note. */ })
      .finally(() => clearTimeout(timeout))
    return () => { mounted = false; clearTimeout(timeout); controller.abort() }
  }, [tab, mergeCatalog])

  const displayedVideos = useMemo(() => {
    const seen = new Set<string>()
    const first = prepended && !orderedBase.some(video => video.id === prepended.id) ? [prepended] : []
    return [...first, ...orderedBase, ...sessionAdded].filter(video => {
      if (seen.has(video.id)) return false
      seen.add(video.id)
      return true
    })
  }, [prepended, orderedBase, sessionAdded])
  const resetPlayback = () => {
    setSessionAdded([])
    setPrepended(null)
    setStarted(false)
    coordinator.setHeld(true)
    coordinator.setActive(null)
    setFeedKey(key => key + 1)
  }
  const applySelection = (ids: string[]) => {
    setClientState(previous => withSelectedCategoryIds(previous, ids))
    resetPlayback()
    setReselecting(false)
    setTab('videos')
  }
  const markViewed = useCallback((id: string) => setClientState(previous => withViewed(previous, id)), [])
  const toggleSaved = (video: FeedVideo) => {
    mergeCatalog([video])
    setClientState(previous => withSavedToggled(previous, video.id))
  }
  const sendFeedback = useCallback((video: FeedVideo, feedbackType: FeedbackType) => {
    const state = clientRef.current
    if (hasFeedbackSent(state, video.id, feedbackType)) return
    const clientId = state.clientId ?? crypto.randomUUID()
    if (state.clientId === null) {
      clientRef.current = withClientId(state, clientId)
      setClientState(previous => withClientId(previous, clientId))
    }
    void submitFeedback({ videoId: video.id, feedbackType, clientId }).then(result => {
      if (result.ok) setClientState(previous => withFeedbackSent(previous, video.id, feedbackType))
    })
  }, [])
  const markNotInterested = (video: FeedVideo) => {
    const index = displayedVideos.findIndex(item => item.id === video.id)
    const successor = displayedVideos[index + 1] ?? displayedVideos[index - 1]
    setClientState(previous => withNotInterested(previous, video.id))
    setOrderedBase(previous => previous.filter(item => item.id !== video.id))
    setSessionAdded(previous => previous.filter(item => item.id !== video.id))
    setPrepended(previous => previous?.id === video.id ? null : previous)
    if (started && successor) setOpenRequest({ externalVideoId: successor.externalVideoId, nonce: Date.now() })
  }
  const openFeedVideo = (video: FeedVideo) => {
    mergeCatalog([video])
    const index = displayedVideos.findIndex(item => item.externalVideoId === video.externalVideoId)
    if (index >= 0) {
      if (!started) { coordinator.startFromGesture(index); setStarted(true) }
    } else if (!started) {
      // Remount to cue the inserted first item, keeping the decisive start gesture separate.
      setPrepended(video)
      setFeedKey(key => key + 1)
    } else {
      setSessionAdded(previous => [...previous, video])
    }
    setOpenRequest({ externalVideoId: video.externalVideoId, nonce: Date.now() })
    setTab('videos')
  }
  const openVideo = (video: SearchVideoDto) => openFeedVideo(feedVideoFromDto(video))
  // Catalog changes also resolve saves loaded outside the selected genres.
  const savedVideos = useMemo(() => clientState.savedVideoIds.flatMap(id => catalog.current.get(id) ?? []), [clientState.savedVideoIds, catalogVersion])
  const retryCategories = () => setCategoriesRetry(value => value + 1)
  const genreScreen = <GenreSelectScreen categories={categories.list} initialSelectedIds={selection ?? []} onSubmit={applySelection} />
  let videoScreen
  if (selection === null || reselecting) {
    videoScreen = categories.status === 'loading' ? <main className="message-screen">読み込み中…</main>
      : categories.status === 'error' ? <main className="message-screen"><p>ジャンルの読み込みに失敗しました</p><button onClick={retryCategories}>再試行</button></main> : genreScreen
  } else if (feed.status === 'loading') {
    videoScreen = <main className="message-screen">動画を読み込んでいます…</main>
  } else if (feed.status === 'error') {
    videoScreen = <main className="message-screen"><p>動画の読み込みに失敗しました</p><button onClick={() => setFeedRetry(value => value + 1)}>再試行</button></main>
  } else if (displayedVideos.length === 0) {
    videoScreen = <main className="message-screen"><p>表示できる動画がありません。</p><p>選んだジャンルに動画がないか、すべて「興味なし」にした可能性があります。</p><button onClick={() => setReselecting(true)}>ジャンルを選び直す</button></main>
  } else if (!started) {
    videoScreen = <main className="start-screen">
      <p className="start-title">タップして動画をはじめる</p>
      <p>ブラウザの仕組み上、音声つきの再生には最初のタップが必要です。裏でプレーヤーを準備しているので、準備が終わる前にタップしても、できた瞬間に再生が始まります。</p>
      <button className="start-button" onClick={begin}>▶ タップして開始</button>
    </main>
  }

  return <div className="app-shell">
    <header className="app-header"><div><p className="eyebrow">SHORTS SPIKE · PHASE 1.5</p><h1>Knowledge Stream<span> / 知るを、つなぐ。</span></h1></div><span className="api-status">{playerMode === 'single' && '単一プレーヤー · '}{!preloadAdjacent && '先読みオフ · '}{apiStatus}</span></header>
    {tab === 'videos' && videoScreen}
    <div className={tab !== 'videos' ? 'feed-host feed-host--tab-hidden' : started ? 'feed-host feed-host--started' : 'feed-host feed-host--preparing'}>
      {feed.status === 'ready' && displayedVideos.length > 0 && <VideoFeed key={feedKey} videos={displayedVideos} preloadAdjacent={preloadAdjacent} coordinator={coordinator} playerMode={playerMode} focusExternalVideoId={openRequest?.externalVideoId} focusNonce={openRequest?.nonce} onActiveVideo={markViewed} savedVideoIds={new Set(clientState.savedVideoIds)} onToggleSaved={toggleSaved} onNotInterested={markNotInterested} feedbackSent={{ helpful: new Set(clientState.feedbackHelpfulVideoIds), wrongCategory: new Set(clientState.feedbackWrongCategoryVideoIds) }} onFeedback={sendFeedback} />}
    </div>
    {tab === 'search' && <SearchView onOpenVideo={openVideo} />}
    {tab === 'profile' && guideOpen && <GuideView onBack={() => setGuideOpen(false)} />}
    {tab === 'profile' && !guideOpen && <ProfileView onOpenGuide={() => setGuideOpen(true)} categories={categories.list} categoriesError={categories.status === 'error'} onRetryCategories={retryCategories} selectedCategoryIds={selection ?? []} onSaveSelection={applySelection}
      savedVideos={savedVideos} unresolvedSavedCount={clientState.savedVideoIds.length - savedVideos.length} onOpenSaved={openFeedVideo} onUnsave={id => setClientState(previous => withSavedToggled(previous, id))}
      viewedCount={clientState.viewedVideoIds.length} savedCount={clientState.savedVideoIds.length} notInterestedCount={clientState.notInterestedVideoIds.length}
      onClearViewed={() => setClientState(withoutViewed)} onClearSaved={() => setClientState(withoutSaved)}
      onClearNotInterested={() => { setClientState(withoutNotInterested); setOrderNonce(value => value + 1) }}
      onClearAll={() => { setClientState(emptyClientState()); resetPlayback() }} />}
    <nav className="bottom-nav" aria-label="メインナビゲーション">
      <button aria-current={tab === 'videos' ? 'page' : undefined} onClick={() => selectTab('videos')}>▶ <span>動画</span></button>
      <button aria-current={tab === 'search' ? 'page' : undefined} onClick={() => selectTab('search')}>⌕ <span>検索</span></button>
      <button aria-current={tab === 'profile' ? 'page' : undefined} onClick={() => selectTab('profile')}>◎ <span>プロフィール</span></button>
    </nav>
  </div>
}
