import { countPlayerWork } from './diagnostics'
export type PlayerControl = Pick<YT.Player, 'pauseVideo' | 'playVideo' | 'mute' | 'unMute'>

// One synchronous authority: pause old players before starting a new one.
// React state/async onReady callbacks are not trusted as playback eligibility.
export class PlaybackCoordinator {
  private players = new Map<number, PlayerControl>()
  private active: number | null = null
  private visible = true
  private blockedByAutoplay = new Set<number>()
  // How long after a genuine gesture its activation still counts. The
  // swipe that brings a video into view starts BEFORE the block for that
  // video comes back, so "gesture first, block recorded second" must not
  // lose the retry the gesture was entitled to (confirmed on a real
  // iPhone 2026-11-09: the second video stayed blocked after a swipe).
  private static readonly GESTURE_WINDOW_MS = 3000
  private lastGestureAt = Number.NEGATIVE_INFINITY
  private gestureRetryStamp = new Map<number, number>()

  setActive(index: number | null) {
    if (this.active === index) return
    this.active = index
    this.reconcile()
  }

  setVisible(visible: boolean) {
    if (this.visible === visible) return
    this.visible = visible
    this.reconcile()
  }

  register(index: number, player: PlayerControl) {
    this.players.set(index, player)
    if (this.canPlay(index)) this.start(player)
    else player.pauseVideo()
  }

  unregister(index: number, player: PlayerControl) {
    if (this.players.get(index) === player) this.players.delete(index)
    this.blockedByAutoplay.delete(index)
    this.gestureRetryStamp.delete(index)
    player.pauseVideo()
  }

  // Stamp the moment of a genuine gesture without retrying anything. Feed
  // calls this on pointerup too: the end of a swipe is the closest real
  // gesture to the block that the swipe's playback attempt may produce.
  noteUserGesture() {
    this.lastGestureAt = performance.now()
  }

  // YouTube refused a sound-on start for this player. Remember it so a
  // genuine user gesture can retry the same request, where browsers allow
  // sound. No synthetic clicks, no muted substitute start: the identical
  // unMute + playVideo request. When the block lands within the gesture
  // window of a real swipe or tap that already happened (the normal order
  // for feed navigation), retry right away, once per gesture per player;
  // a block with no recent gesture keeps waiting for the next real tap.
  onAutoplayBlocked(index: number) {
    this.blockedByAutoplay.add(index)
    if (!this.canPlay(index)) return
    const gestureAt = this.lastGestureAt
    if (performance.now() - gestureAt > PlaybackCoordinator.GESTURE_WINDOW_MS) return
    if (this.gestureRetryStamp.get(index) === gestureAt) return
    const player = this.players.get(index)
    if (!player) return
    this.gestureRetryStamp.set(index, gestureAt)
    this.blockedByAutoplay.delete(index)
    this.start(player)
  }

  // Called from a real pointerdown handler (capture phase). Retries only a
  // start the browser actually blocked, only for the visible active player.
  // A player that reached playing/buffering cleared its flag, so a later
  // tap never overrides a deliberate pause via YouTube's own UI.
  handleUserGesture() {
    this.noteUserGesture()
    if (this.active === null || !this.visible) return
    if (!this.blockedByAutoplay.has(this.active)) return
    const player = this.players.get(this.active)
    if (!player) return
    this.gestureRetryStamp.set(this.active, this.lastGestureAt)
    this.blockedByAutoplay.delete(this.active)
    this.start(player)
  }

  canPlay(index: number) { return this.visible && this.active === index }

  // Explicit retry from an outside-player button after autoplay was blocked.
  play(index: number) {
    if (!this.canPlay(index)) return
    const player = this.players.get(index)
    if (player) this.start(player)
  }

  onStateChange(index: number, player: PlayerControl, state: number) {
    // Playback or buffering actually began: any earlier autoplay block for
    // this player is history, so gestures must not restart it afterwards.
    if (state === 1 || state === 3) {
      this.blockedByAutoplay.delete(index)
      this.gestureRetryStamp.delete(index)
    }
    // Includes unexpected/manual playback or a late buffering event after navigation.
    if ((state === 1 || state === 3) && !this.canPlay(index)) player.pauseVideo()
  }

  private start(player: PlayerControl) {
    countPlayerWork('playRequests')
    // Explicit product choice: request sound on for each new play request.
    // The browser can still reject sound-on playback; do not fake user activation.
    player.unMute()
    player.playVideo()
  }

  private reconcile() {
    for (const [index, player] of this.players) if (!this.canPlay(index)) player.pauseVideo()
    if (this.active !== null && this.visible) {
      const player = this.players.get(this.active)
      if (player) this.start(player)
    }
  }
}
