export const ACTIVE_THRESHOLD = 0.65
// Round 4 (2026-11-10): an entering card that already fills this share of
// the viewport gets one early sound-on play attempt while the swipe is
// still moving, instead of waiting for the settle thresholds above. The
// swipe touch lands inside the YouTube iframe, so the attempt is timed to
// the moment the iframe itself most plausibly still holds the touch's
// transient activation. Settle (selectActive) remains the authority for
// which item is active; see PlaybackCoordinator.attemptEarlyStart.
export const EARLY_PLAY_THRESHOLD = 0.6
// Round 6 (2026-11-11): at the end of a swipe gesture the feed projects
// the scroll offset this far past the release point (release offset plus
// release velocity times this horizon) to predict where the native
// scroll-snap will land, so the navigation decision can be made — and
// the play request issued — inside the gesture-end handler itself,
// while the gesture's transient activation is still alive, instead of
// after the snap animation settles (rounds 1–4 showed settle-time
// requests arrive too late, Safari at every speed). The horizon and the
// feed's velocity clamp are estimates; the settle path stays as the
// correction if the prediction and the actual landing disagree.
export const SWIPE_PROJECTION_MS = 150

// The snap target a swipe is heading for: the nearest snap index to the
// projected position, clamped to the feed bounds and to one card per
// gesture (the cards use scroll-snap-stop: always, so the browser
// itself never carries a single swipe further than one card).
export function decideSwipeTarget(startIndex: number, projectedCards: number, count: number): number {
  if (count <= 0) return startIndex
  const landed = Math.min(count - 1, Math.max(0, Math.round(projectedCards)))
  return Math.min(startIndex + 1, Math.max(startIndex - 1, landed))
}
export interface VisibilitySample { index: number; cardRatio: number; playerRatio: number }

export function selectActive(samples: VisibilitySample[]): number | null {
  const candidate = samples.filter(s => s.cardRatio >= ACTIVE_THRESHOLD && s.playerRatio >= 0.5)
    .sort((a, b) => b.cardRatio - a.cardRatio || a.index - b.index)[0]
  return candidate?.index ?? null
}

export function inMountWindow(index: number, center: number): boolean {
  return Math.abs(index - center) <= 1
}

// Reuse up to three iframe instances; only current ±1 may load media.
export function retainedPlayers(center: number, count: number, previous: number[], preload = true): number[] {
  const wanted = Array.from({ length: count }, (_, index) => index)
    .filter(index => preload ? inMountWindow(index, center) : index === center)
  return [...wanted, ...previous.filter(index => index < count && !wanted.includes(index))]
    .slice(0, preload ? 3 : 1)
}

export function visibleRatio(rect: DOMRect, viewport: DOMRect): number {
  const width = Math.max(0, Math.min(rect.right, viewport.right) - Math.max(rect.left, viewport.left))
  const height = Math.max(0, Math.min(rect.bottom, viewport.bottom) - Math.max(rect.top, viewport.top))
  return rect.width > 0 && rect.height > 0 ? width * height / (rect.width * rect.height) : 0
}
