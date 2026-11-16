import { useEffect, useRef, useState } from 'react'
import type { TestVideo } from '../videos'
import type { SinglePlaybackCoordinator, SinglePlayerControl } from './SinglePlaybackCoordinator'
import { loadYouTubeApi } from './youtubeApi'
import { errorMessage } from './YouTubePlayer'
import { countPlayerWork } from './diagnostics'

// Round 10: the feed's ONE persistent player, rendered as a layer
// inside the scroll container (a child of the feed element, after the
// cards) and positioned over the active card by transform ONLY — the
// iframe is created once and never reparented or unmounted, because
// WebKit reloads an iframe whose DOM parent changes (memo §A). When
// the active index changes, only the layer's transform changes; the
// video itself is switched by the coordinator via loadVideoById.
//
// The iframe is pre-created by hand (memo §C) with enablejsapi=1 and
// an explicit allow attribute, then adopted by the IFrame API via its
// id — the documented pattern, so the generated-embed variables are
// not left to defaults. Nothing is layered above the iframe; the
// gate switches the iframe element's OWN pointer-events property,
// exactly like the per-card players (round 9).
export function SingleYouTubePlayer({ videos, coordinator }: {
  videos: TestVideo[]; coordinator: SinglePlaybackCoordinator
}) {
  const host = useRef<HTMLDivElement>(null)
  const [attempt, setAttempt] = useState(0)
  const [displayIndex, setDisplayIndex] = useState(() => coordinator.getDisplayIndex())
  const [status, setStatus] = useState('YouTubeを読み込み中…')
  const [error, setError] = useState<string | null>(null)
  const [blocked, setBlocked] = useState(false)
  const [slow, setSlow] = useState(false)
  const [canRequestPlay, setCanRequestPlay] = useState(false)

  // The layer follows the coordinator's display index (commit-driven,
  // synchronous with the switch — not the feed's async React state).
  useEffect(() => {
    const update = () => setDisplayIndex(coordinator.getDisplayIndex())
    update()
    return coordinator.subscribeDisplay(update)
  }, [coordinator])

  useEffect(() => {
    let cancelled = false
    let player: YT.Player | undefined
    let readyTimeout: number | undefined
    let bufferTimeout: number | undefined
    const clearBufferWait = () => {
      clearTimeout(bufferTimeout)
      bufferTimeout = undefined
      setSlow(false)
    }
    const control: SinglePlayerControl = {
      pauseVideo: () => player!.pauseVideo(),
      playVideo: () => player!.playVideo(),
      mute: () => player!.mute(),
      unMute: () => player!.unMute(),
      seekTo: (seconds: number, allowSeekAhead: boolean) => player!.seekTo(seconds, allowSeekAhead),
      // The YT typings overload these with a settings-object form;
      // the coordinator only ever calls the string form.
      loadVideoById: ((videoId: string) => player!.loadVideoById(videoId)) as SinglePlayerControl['loadVideoById'],
      cueVideoById: ((videoId: string) => player!.cueVideoById(videoId)) as SinglePlayerControl['cueVideoById'],
    }
    // Pre-create the iframe by hand and hand its id to the API
    // (adoption pattern). Created exactly once per mount attempt,
    // inside the host this component owns.
    const first = videos[0]
    const iframe = document.createElement('iframe')
    const iframeId = `ks-single-player-${attempt}`
    iframe.id = iframeId
    iframe.src = `https://www.youtube.com/embed/${first.externalVideoId}?enablejsapi=1&autoplay=0&controls=1&playsinline=1&origin=${window.location.origin}`
    iframe.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture; web-share')
    iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin')
    iframe.title = `${first.label} — YouTubeプレーヤー`
    iframe.style.pointerEvents = coordinator.isIframeInteractive() ? 'auto' : 'none'
    host.current!.replaceChildren(iframe)
    const applyGate = () => {
      iframe.style.pointerEvents = coordinator.isIframeInteractive() ? 'auto' : 'none'
    }
    const unsubscribeGate = coordinator.subscribeGate(applyGate)
    setError(null)
    setBlocked(false)
    setSlow(false)
    setCanRequestPlay(false)
    setStatus('YouTubeを読み込み中…')
    // Same construction delay as the per-card players: a mount torn
    // down immediately (StrictMode, rapid remount) creates nothing.
    const startTimeout = window.setTimeout(() => {
      void loadYouTubeApi().then(api => {
        if (cancelled) return
        setStatus('プレーヤーを準備中…')
        readyTimeout = window.setTimeout(() => {
          if (!cancelled) setError('プレーヤーの応答がありません。通信を確認して再試行してください。')
        }, 15_000)
        player = new api.Player(iframeId, {
          events: {
            onReady: event => {
              if (cancelled) return
              clearTimeout(readyTimeout)
              setError(null)
              setCanRequestPlay(true)
              setStatus('準備完了。再生されない場合はYouTubeの再生ボタンを押してください。')
              player = event.target
              applyGate()
              coordinator.registerPlayer(control, 0)
            },
            onStateChange: event => {
              if (cancelled) return
              countPlayerWork('stateEvents')
              coordinator.onStateChange(event.data)
              setCanRequestPlay(event.data !== 1 && event.data !== 3)
              if (event.data === 3 && coordinator.canPlay(coordinator.getDisplayIndex())) {
                if (bufferTimeout === undefined) bufferTimeout = window.setTimeout(() => {
                  if (!cancelled && coordinator.canPlay(coordinator.getDisplayIndex())) setSlow(true)
                }, 12_000)
              } else clearBufferWait()
              if (event.data === 1 || event.data === 3) setBlocked(false)
              const states: Record<number, string> = {
                [-1]: '再生待機中', 0: '再生終了。最初からループ再生します。',
                1: '再生中', 2: '一時停止中', 3: '動画を読み込み中…', 5: '再生待機中',
              }
              setStatus(states[event.data] ?? '再生待機中')
            },
            onAutoplayBlocked: () => {
              if (cancelled) return
              clearBufferWait()
              coordinator.onAutoplayBlocked()
              setBlocked(true)
              setStatus('音声付きの自動再生は許可されませんでした。「再生する」を押してください。')
            },
            onError: event => {
              if (cancelled) return
              clearBufferWait()
              setBlocked(false)
              clearTimeout(readyTimeout)
              setError(errorMessage(event.data))
            },
          },
        })
      }).catch(() => {
        if (!cancelled) setError('YouTubeを読み込めません。通信やコンテンツブロッカーを確認してください。')
      })
    }, 150)
    return () => {
      cancelled = true
      unsubscribeGate()
      clearTimeout(startTimeout)
      clearTimeout(readyTimeout)
      clearTimeout(bufferTimeout)
      if (player) {
        coordinator.unregisterPlayer(control)
        player.destroy()
        countPlayerWork('destroyed')
      }
    }
    // videos is the fixed fixture list for the session; attempt drives retries.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coordinator, attempt])

  const actionable = Boolean(error || slow || ((blocked || canRequestPlay) && coordinator.canPlay(displayIndex)))
  return <div className="single-player-layer" style={{ transform: `translateY(${displayIndex * 100}%)` }}>
    <div className="player-slot single-player-slot">
      <div className="player-surface" ref={host} />
      <div className="player-status" data-actionable={actionable} role="status" aria-live="polite">
        <span>{error ?? (slow ? '動画の読み込みが長引いています。再読み込みか次へをお試しください。' : status)}</span>
        {(error || slow) ? <button onClick={() => setAttempt(n => n + 1)}>{error ? '再試行' : '再読み込み'}</button>
          : (blocked || canRequestPlay) && <button disabled={!coordinator.canPlay(displayIndex)} onClick={() => coordinator.play(displayIndex)}>再生する</button>}
      </div>
    </div>
  </div>
}
