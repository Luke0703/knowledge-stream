// The playback surface App and VideoFeed rely on, whichever playback
// core is active. Two implementations exist:
// - PlaybackCoordinator (default): one YT.Player per card, retained in
//   a mount window — the rounds 1–9 architecture.
// - SinglePlaybackCoordinator (?player=single, round 10): ONE
//   persistent YT.Player for the whole feed, switched with
//   loadVideoById, per the WebKit per-element autoplay grant (see
//   ks-round10/research-memo.md).
// The feed's scroll/gesture/settle machinery is shared; only the core
// behind this interface changes, so a device session can A/B the two
// architectures on one preview deploy.
export interface FeedCoordinator {
  // Preparation hold (round 3): while held, players may be created and
  // cued but playback is never requested.
  setHeld(held: boolean): void
  isHeld(): boolean
  // A player able to receive the decisive start tap exists for index.
  isReady(index: number): boolean
  subscribeReady(listener: () => void): () => void
  // The decisive start tap: called synchronously from its handler.
  startFromGesture(index: number): void
  // Measure-driven active item (scroll position authority).
  setActive(index: number | null): void
  setVisible(visible: boolean): void
  // The feed stamps the start of each scroll episode.
  noteScrollStarted(): void
  // The feed closes the episode after its gesture-end / settle
  // handling. The per-card core keys its commits off the episode stamp
  // and treats this as a no-op; the single-player core uses it to
  // release a landing that no commit claimed.
  noteScrollEpisodeEnd(): void
  // Diagnostics: every gesture-end event the parent receives.
  noteGestureEnd(type: string, context?: Record<string, unknown>): void
  noteUserGesture(): void
  // A genuine pointerdown: retry a start the browser blocked.
  handleUserGesture(): void
  // The swipe commit, synchronously inside the gesture-end handler.
  commitSwipeTarget(index: number): void
  // The settle commit: second chance / authority at scroll settle.
  commitSettleTarget(index: number): void
  // Mid-scroll early attempt for an entering item (per-card core only;
  // the single-player core switches at gesture end by design).
  attemptEarlyStart(index: number): void
  canPlay(index: number): boolean
  // Explicit retry from an outside-player button.
  play(index: number): void
}
