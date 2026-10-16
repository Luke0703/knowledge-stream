export type PlayerControl = Pick<YT.Player, 'pauseVideo' | 'playVideo' | 'mute' | 'unMute'>

// One synchronous authority: pause old players before starting a new one.
// React state/async onReady callbacks are not trusted as playback eligibility.
export class PlaybackCoordinator {
  private players = new Map<number, PlayerControl>()
  private active: number | null = null
  private visible = true
  private muted = false

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
    player.pauseVideo()
  }

  canPlay(index: number) { return this.visible && this.active === index }

  // Called directly by a user gesture, never by autoplay or delayed callbacks.
  // These are explicit commands, not a cached mute-state toggle: native UI may change it too.
  setMuted(index: number, muted: boolean) {
    if (!this.canPlay(index)) return
    const player = this.players.get(index)
    if (!player) return
    this.muted = muted
    if (muted) player.mute()
    else player.unMute()
  }

  onStateChange(index: number, player: PlayerControl, state: number) {
    // Includes unexpected/manual playback or a late buffering event after navigation.
    if ((state === 1 || state === 3) && !this.canPlay(index)) player.pauseVideo()
  }

  private start(player: PlayerControl) {
    if (this.muted) player.mute()
    else player.unMute()
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
