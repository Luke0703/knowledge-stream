export type PlayerControl = Pick<YT.Player, 'pauseVideo' | 'playVideo' | 'mute'>

// One synchronous authority: pause old players before starting a new one.
// React state/async onReady callbacks are not trusted as playback eligibility.
export class PlaybackCoordinator {
  private players = new Map<number, PlayerControl>()
  private active: number | null = null
  private visible = true

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

  onStateChange(index: number, player: PlayerControl, state: number) {
    // Includes unexpected/manual playback or a late buffering event after navigation.
    if ((state === 1 || state === 3) && !this.canPlay(index)) player.pauseVideo()
  }

  private start(player: PlayerControl) {
    player.mute()
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
