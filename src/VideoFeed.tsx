import { useEffect, useRef, useState } from 'react'
import { PlaybackCoordinator } from './player/PlaybackCoordinator'
import { inMountWindow, selectActive, visibleRatio } from './player/visibility'
import { YouTubePlayer } from './player/YouTubePlayer'
import type { TestVideo } from './videos'

export function VideoFeed({ videos, preloadAdjacent = true }: { videos: TestVideo[]; preloadAdjacent?: boolean }) {
  const viewport = useRef<HTMLDivElement>(null)
  const measureNow = useRef<(() => void) | null>(null)
  const [coordinator] = useState(() => new PlaybackCoordinator())
  const [active, setActive] = useState<number | null>(null)
  const [center, setCenter] = useState(0)

  useEffect(() => {
    const root = viewport.current
    if (!root) return
    const measure = () => {
      const bounds = root.getBoundingClientRect()
      // Intersection includes viewport clipping (small screens/zoom/URL bar changes).
      const clipped = new DOMRect(Math.max(0, bounds.left), Math.max(0, bounds.top),
        Math.max(0, Math.min(innerWidth, bounds.right) - Math.max(0, bounds.left)),
        Math.max(0, Math.min(innerHeight, bounds.bottom) - Math.max(0, bounds.top)))
      const cards = Array.from(root.querySelectorAll<HTMLElement>('.video-card'))
      const samples = cards.map((card, index) => ({
        index, cardRatio: visibleRatio(card.getBoundingClientRect(), clipped),
        playerRatio: visibleRatio(card.querySelector('.player-surface')!.getBoundingClientRect(), clipped),
      }))
      const next = selectActive(samples)
      const visible = document.visibilityState === 'visible'
      if (!visible) coordinator.setVisible(false)
      coordinator.setActive(next)
      coordinator.setVisible(visible)
      setActive(next)
      if (next !== null) setCenter(next)
    }
    // Synchronous scroll measurement stops the old video before the next React render.
    measureNow.current = measure
    root.addEventListener('scroll', measure, { passive: true })
    window.addEventListener('scroll', measure, { passive: true })
    window.addEventListener('resize', measure)
    window.visualViewport?.addEventListener('resize', measure)
    document.addEventListener('visibilitychange', measure)
    const observer = new ResizeObserver(measure)
    observer.observe(root)
    measure()
    return () => {
      measureNow.current = null
      root.removeEventListener('scroll', measure)
      window.removeEventListener('scroll', measure)
      window.removeEventListener('resize', measure)
      window.visualViewport?.removeEventListener('resize', measure)
      document.removeEventListener('visibilitychange', measure)
      observer.disconnect()
      coordinator.setActive(null)
    }
  }, [coordinator, videos])

  const navigate = (index: number) => {
    const card = viewport.current?.children[index] as HTMLElement | undefined
    if (!card) return
    // Pause immediately; measured visibility, not the button, authorizes playback.
    coordinator.setActive(null)
    card.scrollIntoView({ block: 'start', behavior: 'instant' })
    // Keep the request inside the click gesture for a ready adjacent player.
    // Visibility still gates playback; Safari/YouTube may still reject sound-on autoplay.
    measureNow.current?.()
  }

  if (!videos.length) return <main className="empty-state">テスト動画がありません。動画データを確認してください。</main>

  return <>
    <main className="feed" ref={viewport} aria-label="動画フィード" tabIndex={0}>
      {videos.map((video, index) => <article key={video.id} className="video-card" aria-label={`${index + 1}本目: ${video.label}`} data-active={active === index}>
        <div className="video-meta">
          <span className="eyebrow">{video.category} <span> / {String(index + 1).padStart(2, '0')} · 独自ラベル</span></span>
          <h2>{video.label}</h2>
        </div>
        <div className="player-slot">
          {(preloadAdjacent ? inMountWindow(index, center) : index === center)
            ? <YouTubePlayer video={video} index={index} coordinator={coordinator} />
            : <><div className="player-surface placeholder">近づくとプレーヤーを読み込みます</div><div className="player-status" /></>}
        </div>
        <div className="video-actions">
          <a className="youtube-link" href={`https://www.youtube.com/watch?v=${video.externalVideoId}`} target="_blank" rel="noreferrer">YouTubeで開く ↗</a>
          <div role="group" aria-label="この動画の音声">
            <button disabled={active !== index} onClick={() => coordinator.setMuted(index, false)}>音声オン</button>
            <button disabled={active !== index} onClick={() => coordinator.setMuted(index, true)}>音声オフ</button>
          </div>
        </div>
      </article>)}
    </main>
    <section className="feed-controls" aria-label="動画の切り替え">
      <div><button onClick={() => navigate(center - 1)} disabled={center === 0}>↑ 前へ</button>
        <span aria-live="polite">{center + 1} / {videos.length}</span>
        <button onClick={() => navigate(center + 1)} disabled={center === videos.length - 1}>次へ ↓</button></div>
    </section>
  </>
}
