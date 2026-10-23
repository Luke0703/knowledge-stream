import { useLayoutEffect, useRef, useState } from 'react'
import type { TestVideo } from '../videos'
import type { PlaybackCoordinator } from './PlaybackCoordinator'
import { loadYouTubeApi } from './youtubeApi'

export function errorMessage(code: number): string {
  switch (code) {
    case 2: return '動画IDが正しくありません。'
    case 5: return 'プレーヤーで再生できませんでした。再試行できます。'
    case 100: return '動画が削除・非公開などで利用できません。'
    case 101: case 150: return 'この動画は埋め込み再生が許可されていません。'
    case 153: return '再生元を確認できません。HTTP(S)とRefererの設定を確認してください。'
    default: return `再生エラー（${code}）。再試行するか次の動画へ進んでください。`
  }
}

export function YouTubePlayer({ video, index, coordinator }: {
  video: TestVideo; index: number; coordinator: PlaybackCoordinator
}) {
  const host = useRef<HTMLDivElement>(null)
  const [attempt, setAttempt] = useState(0)
  const [status, setStatus] = useState('YouTubeを読み込み中…')
  const [error, setError] = useState<string | null>(null)
  const [blocked, setBlocked] = useState(false)
  const [slow, setSlow] = useState(false)
  const [canRequestPlay, setCanRequestPlay] = useState(false)

  // Cleanup must run before React detaches the host; YouTube requires a live iframe.
  useLayoutEffect(() => {
    let cancelled = false
    let player: YT.Player | undefined
    let registered = false
    let readyTimeout: number | undefined
    let bufferTimeout: number | undefined
    const clearBufferWait = () => {
      clearTimeout(bufferTimeout)
      bufferTimeout = undefined
      setSlow(false)
    }
    setError(null)
    setBlocked(false)
    setSlow(false)
    setCanRequestPlay(false)
    setStatus('YouTubeを読み込み中…')
    // YT replaces this child, never a React-owned node.
    const mount = document.createElement('div')
    host.current!.replaceChildren(mount)
    // Avoid starting a new iframe for a card crossed during rapid navigation.
    // Ready adjacent players are retained; only new construction is delayed.
    const startTimeout = window.setTimeout(() => {
      void loadYouTubeApi().then(api => {
        if (cancelled) return
        setStatus('プレーヤーを準備中…')
        readyTimeout = window.setTimeout(() => {
          if (!cancelled) setError('プレーヤーの応答がありません。通信を確認して再試行してください。')
        }, 15_000)
        player = new api.Player(mount, {
          width: '100%', height: '100%', videoId: video.externalVideoId,
          playerVars: { autoplay: 0, controls: 1, playsinline: 1, origin: window.location.origin },
          events: {
            onReady: event => {
              if (cancelled) return
              clearTimeout(readyTimeout)
              setError(null)
              setCanRequestPlay(true)
              setStatus('準備完了。再生されない場合はYouTubeの再生ボタンを押してください。')
              registered = true
              coordinator.register(index, event.target)
            },
            onStateChange: event => {
              if (cancelled) return
              coordinator.onStateChange(index, event.target, event.data)
              setCanRequestPlay(event.data !== 1 && event.data !== 3)
              if (event.data === 3 && coordinator.canPlay(index)) {
                if (bufferTimeout === undefined) bufferTimeout = window.setTimeout(() => {
                  if (!cancelled && coordinator.canPlay(index)) setSlow(true)
                }, 12_000)
              } else clearBufferWait()
              if (event.data === 1 || event.data === 3) setBlocked(false)
              const states: Record<number, string> = {
                [-1]: '再生待機中', 0: '再生終了。次の動画へ進めます。',
                1: '再生中', 2: '一時停止中', 3: '動画を読み込み中…', 5: '再生待機中',
              }
              setStatus(states[event.data] ?? '再生待機中')
            },
            onAutoplayBlocked: () => {
              if (cancelled) return
              clearBufferWait()
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
        player.getIframe().title = `${video.label} — YouTubeプレーヤー`
        player.getIframe().setAttribute('referrerpolicy', 'strict-origin-when-cross-origin')
      }).catch(() => {
        if (!cancelled) setError('YouTubeを読み込めません。通信やコンテンツブロッカーを確認してください。')
      })
    }, 150)
    return () => {
      cancelled = true
      clearTimeout(startTimeout)
      clearTimeout(readyTimeout)
      clearTimeout(bufferTimeout)
      if (player) {
        if (registered) coordinator.unregister(index, player)
        player.destroy()
      }
    }
  }, [video, index, coordinator, attempt])

  return <>
    <div className="player-surface" ref={host} />
    <div className="player-status" role="status" aria-live="polite">
      <span>{error ?? (slow ? '動画の読み込みが長引いています。再読み込みか次へをお試しください。' : status)}</span>
      {(error || slow) ? <button onClick={() => setAttempt(n => n + 1)}>{error ? '再試行' : '再読み込み'}</button>
        : (blocked || canRequestPlay) && <button disabled={!coordinator.canPlay(index)} onClick={() => coordinator.play(index)}>再生する</button>}
    </div>
  </>
}
