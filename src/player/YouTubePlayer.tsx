import { useEffect, useRef, useState } from 'react'
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

  useEffect(() => {
    let cancelled = false
    let player: YT.Player | undefined
    let registered = false
    let readyTimeout: number | undefined
    setError(null)
    setStatus('YouTubeを読み込み中…')
    // YT replaces this child, never a React-owned node.
    const mount = document.createElement('div')
    host.current!.replaceChildren(mount)
    void loadYouTubeApi().then(api => {
      if (cancelled) return
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
            setStatus('準備完了。再生されない場合はYouTubeの再生ボタンを押してください。')
            registered = true
            coordinator.register(index, event.target)
          },
          onStateChange: event => {
            if (cancelled) return
            coordinator.onStateChange(index, event.target, event.data)
            const states: Record<number, string> = {
              [-1]: '再生待機中', 0: '再生終了。次の動画へ進めます。',
              1: '再生中', 2: '一時停止中', 3: 'バッファリング中…', 5: '再生待機中',
            }
            setStatus(states[event.data] ?? '再生待機中')
          },
          onAutoplayBlocked: () => {
            if (!cancelled) setStatus('自動再生が制限されています。YouTubeの再生ボタンを押してください。')
          },
          onError: event => {
            if (cancelled) return
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
    return () => {
      cancelled = true
      clearTimeout(readyTimeout)
      if (player) {
        if (registered) coordinator.unregister(index, player)
        player.destroy()
      }
    }
  }, [video, index, coordinator, attempt])

  return <>
    <div className="player-surface" ref={host} />
    <div className="player-status" role="status" aria-live="polite">
      <span>{error ?? status}</span>
      {error && <button onClick={() => setAttempt(n => n + 1)}>再試行</button>}
    </div>
  </>
}
