import { useEffect, useRef, useState } from 'react'
import { PlaybackCoordinator } from './player/PlaybackCoordinator'
import { SinglePlaybackCoordinator } from './player/SinglePlaybackCoordinator'
import type { FeedCoordinator } from './player/FeedCoordinator'
import { decideSwipeTarget, EARLY_PLAY_THRESHOLD, inMountWindow, retainedPlayers, selectActive, SWIPE_PROJECTION_MS, visibleRatio } from './player/visibility'
import { YouTubePlayer } from './player/YouTubePlayer'
import { SingleYouTubePlayer } from './player/SingleYouTubePlayer'
import type { TestVideo } from './videos'
import { countPlayerWork, diagnosticEvent } from './player/diagnostics'

export function VideoFeed({ videos, preloadAdjacent = true, coordinator: coordinatorProp, playerMode = 'multi' }: { videos: TestVideo[]; preloadAdjacent?: boolean; coordinator?: FeedCoordinator; playerMode?: 'multi' | 'single' }) {
  const viewport = useRef<HTMLDivElement>(null)
  const measureNow = useRef<(() => void) | null>(null)
  // App passes its coordinator so the start tap (stamped before the feed
  // mounts) counts toward the first player's gesture window. Standalone
  // use (tests) falls back to an internal one.
  const [ownCoordinator] = useState(() => new PlaybackCoordinator())
  const coordinator = coordinatorProp ?? ownCoordinator
  // Round 10 (?player=single): one persistent player for the whole
  // feed. Single mode is only real when the matching coordinator core
  // was passed; the scroll/gesture/settle machinery below is shared
  // unchanged, and the commits land on the single-player core, whose
  // switch is issued synchronously inside the same handlers.
  const singleCoordinator = coordinator instanceof SinglePlaybackCoordinator ? coordinator : null
  const single = playerMode === 'single' && singleCoordinator !== null
  const [active, setActive] = useState<number | null>(null)
  const [center, setCenter] = useState(0)
  const [previousPlayers, setPreviousPlayers] = useState<number[]>([])
  const mounted = retainedPlayers(center, videos.length, previousPlayers, preloadAdjacent)
  useEffect(() => {
    setPreviousPlayers(previous => retainedPlayers(center, videos.length, previous, preloadAdjacent))
  }, [center, videos.length, preloadAdjacent])

  useEffect(() => {
    const root = viewport.current
    if (!root) return
    if (singleCoordinator) {
      singleCoordinator.setVideos(videos)
      diagnosticEvent('singlePlayer', { action: 'enabled' })
    }
    const computeSettled = () => {
      const bounds = root.getBoundingClientRect()
      // Intersection includes viewport clipping (small screens/zoom/URL bar changes).
      const clipped = new DOMRect(Math.max(0, bounds.left), Math.max(0, bounds.top),
        Math.max(0, Math.min(innerWidth, bounds.right) - Math.max(0, bounds.left)),
        Math.max(0, Math.min(innerHeight, bounds.bottom) - Math.max(0, bounds.top)))
      const cards = Array.from(root.querySelectorAll<HTMLElement>('.video-card'))
      const samples = cards.map((card, index) => {
        const rect = card.getBoundingClientRect()
        return {
          index, cardRatio: visibleRatio(rect, clipped),
          // Loading follows the feed position, even if the browser clips the card.
          loadRatio: visibleRatio(rect, bounds),
          playerRatio: visibleRatio(card.querySelector('.player-surface')!.getBoundingClientRect(), clipped),
        }
      })
      return { samples, next: selectActive(samples) }
    }
    const measure = () => {
      countPlayerWork('measure')
      const { samples, next } = computeSettled()
      const visible = document.visibilityState === 'visible'
      if (!visible) coordinator.setVisible(false)
      coordinator.setActive(next)
      coordinator.setVisible(visible)
      setActive(next)
      setCenter(previous => samples.reduce((best, sample) =>
        sample.loadRatio > (samples[best]?.loadRatio ?? 0) ? sample.index : best, previous))
      // Round 4: the entering item that already fills the early share of
      // the viewport gets its one sound-on attempt NOW, mid-scroll, while
      // the swipe's touch may still count as activation inside the
      // YouTube iframe — instead of only after the scroll settles, which
      // rounds 1–3 showed arrives too late on real devices. The settled
      // active item is excluded (setActive above already issued its
      // request), and the coordinator itself dedupes per approach, so
      // repeated measures during one swipe do not repeat the attempt.
      const entering = samples
        .filter(sample => sample.index !== next && sample.cardRatio >= EARLY_PLAY_THRESHOLD)
        .sort((a, b) => b.cardRatio - a.cardRatio)[0]
      // Single-player mode has no per-card player to attempt early:
      // its one player switches at gesture end by design (round 10).
      if (entering && !single) coordinator.attemptEarlyStart(entering.index)
    }
    // Synchronous scroll measurement stops the old video before the next React render.
    measureNow.current = measure
    // The first genuine tap retries a sound-on start the browser blocked.
    // Capture phase keeps the retry inside the gesture's own call stack.
    const unlock = () => coordinator.handleUserGesture()
    window.addEventListener('pointerdown', unlock, { capture: true })
    // A swipe's pointerdown precedes the block its landing produces, so
    // stamp the gesture's end as well; the coordinator retries a block
    // that lands within the gesture window, once per real gesture.
    const stampGestureEnd = () => coordinator.noteUserGesture()
    window.addEventListener('pointerup', stampGestureEnd, { capture: true, passive: true })
    // The feed's own scroll: stamp the start of each new scroll episode
    // (a quiet gap separates one swipe from the next) before measuring,
    // so round-4 diagnostics can time play attempts from the swipe start.
    // Round 6 (2026-11-11) also tracks the episode's scroll offsets so
    // the gesture's end can decide the navigation (see onGestureEnd).
    const EPISODE_GAP_MS = 250
    const VELOCITY_WINDOW_MS = 120
    const VELOCITY_CLAMP_PX_PER_MS = 3
    interface SwipeGesture { startOffset: number; samples: { offset: number; at: number }[]; handled: boolean }
    let gesture: SwipeGesture | null = null
    const gestureLive = (now: number) =>
      gesture !== null && now - gesture.samples[gesture.samples.length - 1].at <= EPISODE_GAP_MS
    // Round 7 settle timers (see onSettle below). A new scroll episode
    // invalidates any settle still pending from the previous one.
    let settleTimer: number | null = null
    let settleRafFirst: number | null = null
    let settleRafSecond: number | null = null
    const clearSettleTimers = () => {
      if (settleTimer !== null) { clearTimeout(settleTimer); settleTimer = null }
      if (settleRafFirst !== null) { cancelAnimationFrame(settleRafFirst); settleRafFirst = null }
      if (settleRafSecond !== null) { cancelAnimationFrame(settleRafSecond); settleRafSecond = null }
    }
    const beginGesture = (now: number) => {
      clearSettleTimers()
      gesture = { startOffset: root.scrollTop, samples: [{ offset: root.scrollTop, at: now }], handled: false }
      coordinator.noteScrollStarted()
    }
    const beginGestureFromPointer = () => {
      const now = performance.now()
      if (!gestureLive(now)) beginGesture(now)
    }
    // Round 7 (2026-11-13): commit at scroll settle. On a real iPhone
    // the gesture-end path never fires (the iframe keeps the touch), so
    // the scroll stopping is the only reliable "the swipe finished"
    // signal the parent can see. Two sources feed one handler: the
    // native 'scrollend' event where the browser supports it, and a
    // stillness fallback (~150 ms with no scroll event and scrollTop
    // stable across two animation frames) for browsers without it. The
    // stillness fallback additionally requires the feed to rest at a
    // snap point: a finger paused mid-swipe holds the card between
    // cards and must not commit before the swipe finishes.
    const SETTLE_STILLNESS_MS = 150
    const SETTLE_SNAP_EPSILON_PX = 4
    const onSettle = () => {
      clearSettleTimers()
      if (!gesture || gesture.handled) return
      gesture.handled = true
      const cardSize = root.getBoundingClientRect().height // Cards are exactly the feed's height.
      if (cardSize <= 0) return
      const { next } = computeSettled()
      if (next === null) return
      const startIndex = Math.min(videos.length - 1, Math.max(0, Math.round(gesture.startOffset / cardSize)))
      if (next === startIndex) { coordinator.noteScrollEpisodeEnd(); return } // Snap-back: the swipe never left the starting card.
      coordinator.commitSettleTarget(next)
      // Sync React state with the settled position. The commit above
      // already authorized playback, so this measure issues no second
      // request for the same target.
      measure()
      coordinator.noteScrollEpisodeEnd()
    }
    const scheduleStillnessCheck = () => {
      clearSettleTimers()
      settleTimer = window.setTimeout(() => {
        settleTimer = null
        settleRafFirst = requestAnimationFrame(() => {
          settleRafFirst = null
          const first = root.scrollTop
          settleRafSecond = requestAnimationFrame(() => {
            settleRafSecond = null
            if (root.scrollTop !== first) return
            const cardSize = root.getBoundingClientRect().height
            if (cardSize <= 0) return
            const remainder = root.scrollTop % cardSize
            if (Math.min(remainder, cardSize - remainder) > SETTLE_SNAP_EPSILON_PX) return
            onSettle()
          })
        })
      }, SETTLE_STILLNESS_MS)
    }
    const onScrollEnd = () => onSettle()
    const onFeedScroll = () => {
      const now = performance.now()
      if (!gestureLive(now)) beginGesture(now)
      else if (gesture) {
        gesture.samples.push({ offset: root.scrollTop, at: now })
        if (gesture.samples.length > 8) gesture.samples.shift()
      }
      measure()
      scheduleStillnessCheck()
    }
    // Round 6: decide the swipe INSIDE the gesture-end handler, while
    // the genuine gesture's transient activation is still alive, instead
    // of waiting for the scroll to settle (rounds 1–4: settle-time
    // requests arrive after the activation expired; Safari blocked at
    // every speed). The predicted target comes from the swipe's travel
    // plus its release velocity projected a short way forward — the
    // point the native scroll-snap is heading for. The visual landing
    // itself is left to that native snap: forcing scrollTop mid-
    // momentum could fight it, and when prediction and landing disagree
    // the ordinary settle path (setActive in measure) still corrects.
    // A gesture that does not pass the commit point snaps back with no
    // play request, exactly as before.
    //
    // Round 9 (2026-11-14): this handler is revived as the primary
    // path, with its round-6 failure — the end events never reaching
    // the parent at all, because the swipe's touch is captured inside
    // the YouTube iframe — addressed by the coordinator's
    // pointer-events gate: every not-yet-playing card's iframe has
    // pointer-events: none (the iframe element's own property, NOT an
    // overlay above the player), so a swipe starting on such a card
    // delivers its full touch stream, gesture end included, to this
    // document. A swipe that starts on the one settled playing card
    // may still lose its end event to that card's iframe; the round-8
    // settle commit remains its second chance. Every end event that
    // DOES arrive is logged before dedupe (noteGestureEnd), so a
    // device session can finally distinguish "the event never
    // arrived" from "it arrived and the request was blocked".
    // pointercancel is treated as a gesture end like the others: a
    // browser that takes the gesture over (scroll takeover, system
    // gesture) may end the stream with a cancel instead of an up/end,
    // and the samples-plus-projection decision below is the guard —
    // a cancel with no recorded travel projects onto the starting
    // card and commits nothing.
    const onGestureEnd = (type: string) => {
      coordinator.noteGestureEnd(type, { episodeActive: gesture !== null, alreadyHandled: gesture?.handled ?? false })
      clearSettleTimers()
      if (!gesture || gesture.handled) return
      gesture.handled = true
      const cardSize = root.getBoundingClientRect().height // Cards are exactly the feed's height.
      if (cardSize <= 0) return
      const startIndex = Math.min(videos.length - 1, Math.max(0, Math.round(gesture.startOffset / cardSize)))
      const samples = gesture.samples
      const last = samples[samples.length - 1]
      const windowFirst = samples.find(sample => sample.at >= last.at - VELOCITY_WINDOW_MS) ?? last
      let velocity = 0
      if (last.at > windowFirst.at) {
        velocity = Math.min(VELOCITY_CLAMP_PX_PER_MS, Math.max(-VELOCITY_CLAMP_PX_PER_MS,
          (last.offset - windowFirst.offset) / (last.at - windowFirst.at)))
      }
      const projected = root.scrollTop + velocity * SWIPE_PROJECTION_MS
      const target = decideSwipeTarget(startIndex, projected / cardSize, videos.length)
      if (target !== startIndex) coordinator.commitSwipeTarget(target)
      coordinator.noteScrollEpisodeEnd()
    }
    // Pointer events cover touch and mouse uniformly; the touchend /
    // touchcancel listeners are the fallback for browsers that route a
    // scroll gesture's end only through the touch stream. The
    // coordinator dedupes a commit per scroll episode, and `handled`
    // dedupes here, so several end events for one gesture are safe.
    // A mouse drag does not scroll the feed natively, so its travel is
    // zero and it simply never commits — desktop behaviour is unchanged.
    const onPointerUp = () => onGestureEnd('pointerup')
    const onPointerCancel = () => onGestureEnd('pointercancel')
    const onTouchEnd = () => onGestureEnd('touchend')
    const onTouchCancel = () => onGestureEnd('touchcancel')
    window.addEventListener('pointerdown', beginGestureFromPointer, { capture: true })
    window.addEventListener('pointerup', onPointerUp, { capture: true })
    window.addEventListener('pointercancel', onPointerCancel, { capture: true })
    window.addEventListener('touchend', onTouchEnd, { capture: true })
    window.addEventListener('touchcancel', onTouchCancel, { capture: true })
    root.addEventListener('scroll', onFeedScroll, { passive: true })
    root.addEventListener('scrollend', onScrollEnd)
    window.addEventListener('scroll', measure, { passive: true })
    window.addEventListener('resize', measure)
    // visualViewport events fire continuously during iOS scrolling and
    // URL-bar show/hide, and each one used to run a full synchronous
    // measure (DOM reads + coordinator reconcile + state pass), duplicating
    // the feed-scroll path. Coalesce them to at most one measure per
    // animation frame; the feed's own scroll handler stays synchronous.
    let viewportFrame: number | null = null
    const measureViewport = () => {
      if (viewportFrame !== null) return
      viewportFrame = requestAnimationFrame(() => { viewportFrame = null; measure() })
    }
    window.visualViewport?.addEventListener('resize', measureViewport)
    window.visualViewport?.addEventListener('scroll', measureViewport)
    document.addEventListener('visibilitychange', measure)
    const observer = new ResizeObserver(measure)
    observer.observe(root)
    measure()
    return () => {
      measureNow.current = null
      window.removeEventListener('pointerdown', unlock, { capture: true })
      window.removeEventListener('pointerup', stampGestureEnd, { capture: true })
      window.removeEventListener('pointerdown', beginGestureFromPointer, { capture: true })
      window.removeEventListener('pointerup', onPointerUp, { capture: true })
      window.removeEventListener('pointercancel', onPointerCancel, { capture: true })
      window.removeEventListener('touchend', onTouchEnd, { capture: true })
      window.removeEventListener('touchcancel', onTouchCancel, { capture: true })
      root.removeEventListener('scroll', onFeedScroll)
      root.removeEventListener('scrollend', onScrollEnd)
      clearSettleTimers()
      window.removeEventListener('scroll', measure)
      window.removeEventListener('resize', measure)
      window.visualViewport?.removeEventListener('resize', measureViewport)
      window.visualViewport?.removeEventListener('scroll', measureViewport)
      if (viewportFrame !== null) cancelAnimationFrame(viewportFrame)
      document.removeEventListener('visibilitychange', measure)
      observer.disconnect()
      coordinator.setActive(null)
    }
  }, [coordinator, videos, single, singleCoordinator])

  const navigate = (index: number) => {
    const root = viewport.current
    const card = root?.children[index] as HTMLElement | undefined
    if (!root || !card) return
    // Pause immediately; measured visibility, not the button, authorizes playback.
    coordinator.setActive(null)
    // Move only the feed, not the outer page/URL bar as scrollIntoView can do.
    root.scrollTo({ top: root.scrollTop + card.getBoundingClientRect().top - root.getBoundingClientRect().top, behavior: 'instant' })
    // Keep the request inside the click gesture for a ready adjacent player.
    // Visibility still gates playback; Safari/YouTube may still reject sound-on autoplay.
    measureNow.current?.()
    // Single-player mode: the measure above only records the landing
    // (a scroll episode may be open from the button's pointerdown), so
    // issue the switch explicitly — still inside this click handler.
    if (single) coordinator.commitSettleTarget(index)
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
          {single
            ? <><div className="player-surface placeholder">{video.label}</div><div className="player-status" /></>
            : mounted.includes(index)
              ? <YouTubePlayer video={video} index={index} coordinator={coordinator as PlaybackCoordinator} load={preloadAdjacent ? inMountWindow(index, center) : index === center} />
              : <><div className="player-surface placeholder">近づくとプレーヤーを読み込みます</div><div className="player-status" /></>}
        </div>
      </article>)}
      {single && singleCoordinator && <SingleYouTubePlayer videos={videos} coordinator={singleCoordinator} />}
    </main>
    <section className="feed-controls" aria-label="動画の切り替え">
      <div><button onClick={() => navigate(center - 1)} disabled={center === 0}>↑ 前へ</button>
        <div className="current-video"><span aria-live="polite">{center + 1} / {videos.length}</span>
          <a className="youtube-link" href={`https://www.youtube.com/watch?v=${videos[center].externalVideoId}`} target="_blank" rel="noreferrer">{videos[center].label} ↗</a></div>
        <button onClick={() => navigate(center + 1)} disabled={center === videos.length - 1}>次へ ↓</button></div>
    </section>
  </>
}
