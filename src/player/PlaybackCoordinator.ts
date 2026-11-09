import { countPlayerWork, diagnosticEvent } from './diagnostics'
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
  // Preparation hold (round 3, 2026-11-10): while held, players may be
  // created and registered (cued, ready) but no playback is ever
  // requested. Real-device results showed the old order — tap first,
  // mount the feed second, request play seconds later from onReady —
  // loses Safari's transient activation before the request is sent, and
  // stamping that tap plus retrying afterwards does not restore it.
  // Holding lets the app prepare the first player BEFORE the decisive
  // tap, so startFromGesture() can send the request synchronously
  // inside that tap's own event handler.
  private held = false
  private readyListeners = new Set<() => void>()

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
    diagnosticEvent('playerReady', { index, held: this.held, msSinceGesture: this.msSinceGesture() })
    if (this.canPlay(index)) this.start(player)
    else player.pauseVideo()
    this.notifyReadyListeners()
  }

  unregister(index: number, player: PlayerControl) {
    if (this.players.get(index) === player) this.players.delete(index)
    this.blockedByAutoplay.delete(index)
    this.gestureRetryStamp.delete(index)
    player.pauseVideo()
    this.notifyReadyListeners()
  }

  // Preparation hold control. setHeld(false) on its own only lifts the
  // hold and reconciles; the start screen uses startFromGesture() so the
  // first play request stays inside the decisive tap's handler.
  setHeld(held: boolean) {
    if (this.held === held) return
    this.held = held
    this.reconcile()
  }

  isHeld() { return this.held }

  // A player is "ready" once YouTube's onReady path registered it.
  isReady(index: number) { return this.players.has(index) }

  subscribeReady(listener: () => void) {
    this.readyListeners.add(listener)
    return () => { this.readyListeners.delete(listener) }
  }

  private notifyReadyListeners() {
    for (const listener of this.readyListeners) listener()
  }

  private msSinceGesture() {
    return Number.isFinite(this.lastGestureAt) ? Math.round(performance.now() - this.lastGestureAt) : null
  }

  // The decisive start tap. Must be called synchronously from a genuine
  // tap/click handler: it stamps that gesture, lifts the hold, makes the
  // index active and — when the player is already ready — sends the
  // identical sound-on request (unMute + playVideo) in the same call
  // stack, while the browser still attributes it to the tap. When the
  // player is not ready yet, the activation cannot be banked: the index
  // is armed as active and the later register() issues the request,
  // which the browser may still block (the feed's 「再生する」 remains).
  startFromGesture(index: number) {
    this.noteUserGesture()
    this.held = false
    this.active = index
    for (const [other, player] of this.players) if (other !== index) player.pauseVideo()
    const player = this.players.get(index)
    if (player && this.visible) {
      this.blockedByAutoplay.delete(index)
      this.start(player)
    }
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
    diagnosticEvent('autoplayBlocked', { index, msSinceGesture: this.msSinceGesture() })
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
    if (this.held) return // Preparation: no block can exist yet; the decisive tap uses startFromGesture().
    if (this.active === null || !this.visible) return
    if (!this.blockedByAutoplay.has(this.active)) return
    const player = this.players.get(this.active)
    if (!player) return
    this.gestureRetryStamp.set(this.active, this.lastGestureAt)
    this.blockedByAutoplay.delete(this.active)
    this.start(player)
  }

  canPlay(index: number) { return !this.held && this.visible && this.active === index }

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
    diagnosticEvent('playRequest', { msSinceGesture: this.msSinceGesture() })
    // Explicit product choice: request sound on for each new play request.
    // The browser can still reject sound-on playback; do not fake user activation.
    player.unMute()
    player.playVideo()
  }

  private reconcile() {
    if (this.held) {
      // Preparation phase: keep every prepared player paused and never
      // issue a play request, so no autoplay block is generated before
      // the decisive tap.
      for (const [, player] of this.players) player.pauseVideo()
      return
    }
    for (const [index, player] of this.players) if (!this.canPlay(index)) player.pauseVideo()
    if (this.active !== null && this.visible) {
      const player = this.players.get(this.active)
      if (player) this.start(player)
    }
  }
}
