import { countPlayerWork } from './diagnostics'
export type PlayerControl = Pick<YT.Player, 'pauseVideo' | 'playVideo' | 'mute' | 'unMute'>

// One synchronous authority: pause old players before starting a new one.
// React state/async onReady callbacks are not trusted as playback eligibility.
export class PlaybackCoordinator {
  private players = new Map<number, PlayerControl>()
  private active: number | null = null
  private visible = true
  private blockedByAutoplay = new Set<number>()

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
    player.pauseVideo()
  }

  // YouTube refused a sound-on start for this player. Remember it so the
  // first genuine user gesture can retry the same request inside that
  // gesture's call stack, where browsers allow sound. No synthetic clicks,
  // no muted substitute start: the identical unMute + playVideo request.
  onAutoplayBlocked(index: number) {
    this.blockedByAutoplay.add(index)
  }

  // Called from a real pointerdown handler (capture phase). Retries only a
  // start the browser actually blocked, only for the visible active player.
  // A player that reached playing/buffering cleared its flag, so a later
  // tap never overrides a deliberate pause via YouTube's own UI.
  handleUserGesture() {
    if (this.active === null || !this.visible) return
    if (!this.blockedByAutoplay.has(this.active)) return
    const player = this.players.get(this.active)
    if (!player) return
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
    if (state === 1 || state === 3) this.blockedByAutoplay.delete(index)
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
