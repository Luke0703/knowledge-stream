import { countPlayerWork, diagnosticEvent, userActivationSnapshot } from './diagnostics'
import type { TestVideo } from '../videos'
import type { FeedCoordinator } from './FeedCoordinator'

// The control surface of the ONE persistent player. loadVideoById is
// the switch: it loads AND plays, which is why a switch is unMute +
// loadVideoById while a restart of the loaded video is unMute +
// playVideo.
export type SinglePlayerControl = Pick<YT.Player, 'pauseVideo' | 'playVideo' | 'mute' | 'unMute' | 'seekTo' | 'loadVideoById' | 'cueVideoById'>

type SwitchReason = 'start-gesture' | 'touchend-commit' | 'settle-commit' | 'explicit-play' | 'blocked-retry' | 'gesture-retry' | 'loop' | 'reconcile'

// Round 10 (2026-11-15): the single-persistent-player core. Design
// authority: ~/workspace/today-tasks/ks-round10/research-memo.md.
//
// Why this can work where rounds 1–9 could not: WebKit grants the
// unmuted-autoplay allowance PER MEDIA ELEMENT and advises changing
// the source of one element instead of creating new ones. Rounds 1–9
// created one player per card, so the first tap blessed only video 1's
// element; videos 2/3 lived in unblessed elements. Here the whole feed
// shares one YT.Player whose iframe is created once and NEVER
// reparented or unmounted (WebKit reloads moved iframes): the
// component positions its layer inside the scroll container by
// transform only, and switching is loadVideoById on that one player.
//
// The switch is issued SYNCHRONOUSLY inside the gesture-end handler
// (commitSwipeTarget, fed by VideoFeed's unchanged gesture machinery)
// — the field report behind the memo is explicit that a deferred call
// "never counts". The settle commit remains as the second chance for
// swipes whose end event the one gate-open iframe still captures.
//
// Kept from the per-card core: the preparation hold + startFromGesture
// blessing path (round 3, device-verified), the blocked bookkeeping
// with one gesture-window retry, the 「再生する」 tap fallback, the
// ENDED loop (round 5), and the pointer-events gate — here applied to
// the single iframe, so a swipe starting on a not-yet-playing surface
// reaches the parent, and the settled playing video keeps YouTube's
// official UI.
export class SinglePlaybackCoordinator implements FeedCoordinator {
  private videos: readonly TestVideo[] = []
  private player: SinglePlayerControl | null = null
  // The index whose video the player currently holds (cued or loaded).
  private loadedIndex: number | null = null
  // The settled/committed logical item; null while navigating away.
  private activeIndex: number | null = null
  // Where the player layer sits (transform-driven by the component).
  private displayIndex = 0
  private displayListeners = new Set<() => void>()
  private held = false
  private visible = true
  private readyListeners = new Set<() => void>()
  // True once a genuine gesture has started this player with sound
  // (the "blessing" the memo's architecture banks on), or playback
  // with sound was observed. Recorded in diagnostics as singlePlayer
  // blessing events.
  private blessed = false
  private blockedIndex: number | null = null
  private playingIndex: number | null = null
  // A start was issued for this index and nothing has contradicted it
  // (no pause, block or end since): duplicate starts are suppressed.
  private startIssuedFor: number | null = null
  // Scroll-episode bookkeeping, mirroring the per-card core: commits
  // are once per episode and target, keyed by the episode stamp.
  private scrollStartedAt: number | null = null
  private episodeOpen = false
  private episodeCommittedIndex: number | null = null
  private pendingActive: number | null = null
  private lastCommit: { index: number; episodeAt: number | null } | null = null
  // A switch requested before the player existed (the decisive tap can
  // precede onReady); registerPlayer applies it.
  private pendingSwitch: number | null = null
  private static readonly GESTURE_WINDOW_MS = 3000
  private lastGestureAt = Number.NEGATIVE_INFINITY
  private gestureRetryStamp: number | null = null
  // The pointer-events gate for the one iframe (round 9, adapted).
  private gateOpen = false
  private gateListeners = new Set<() => void>()

  setVideos(videos: readonly TestVideo[]) { this.videos = videos }

  // ---- registration (called by SingleYouTubePlayer) ----

  registerPlayer(control: SinglePlayerControl, initialIndex: number) {
    this.player = control
    this.loadedIndex = initialIndex
    if (this.displayIndex !== initialIndex && this.pendingSwitch === null) this.setDisplayIndex(initialIndex)
    diagnosticEvent('singlePlayer', { action: 'ready', index: initialIndex, blessed: this.blessed })
    countPlayerWork('created')
    if (this.held) {
      control.pauseVideo()
    } else if (this.pendingSwitch !== null && this.pendingSwitch !== initialIndex) {
      const target = this.pendingSwitch
      this.pendingSwitch = null
      this.switchTo(target, 'reconcile')
    } else if (this.pendingSwitch !== null) {
      this.pendingSwitch = null
      this.startIssuedFor = null
      this.startLoaded('reconcile')
    } else if (this.visible && this.activeIndex === initialIndex) {
      this.startLoaded('reconcile')
    }
    this.notifyReadyListeners()
  }

  unregisterPlayer(control: SinglePlayerControl) {
    if (this.player === control) this.player = null
    if (this.gateOpen) this.setGate(false, 'unregister')
    control.pauseVideo()
    this.notifyReadyListeners()
  }

  isReady(index: number) { return this.player !== null && index === 0 }

  subscribeReady(listener: () => void) {
    this.readyListeners.add(listener)
    return () => { this.readyListeners.delete(listener) }
  }

  private notifyReadyListeners() {
    for (const listener of [...this.readyListeners]) listener()
  }

  // ---- display position (the layer's transform) ----

  getDisplayIndex() { return this.displayIndex }

  subscribeDisplay(listener: () => void) {
    this.displayListeners.add(listener)
    return () => { this.displayListeners.delete(listener) }
  }

  private setDisplayIndex(index: number) {
    if (this.displayIndex === index) return
    this.displayIndex = index
    for (const listener of [...this.displayListeners]) listener()
  }

  // ---- pointer-events gate for the single iframe ----

  isIframeInteractive() { return this.gateOpen }

  subscribeGate(listener: () => void) {
    this.gateListeners.add(listener)
    return () => { this.gateListeners.delete(listener) }
  }

  private setGate(open: boolean, reason: string) {
    if (this.gateOpen === open) return
    this.gateOpen = open
    diagnosticEvent('pointerGate', { index: this.displayIndex, interactive: open, reason, msSinceScrollStart: this.msSinceScrollStart(), userActivation: userActivationSnapshot() })
    for (const listener of [...this.gateListeners]) listener()
  }

  // ---- hold / visibility ----

  setHeld(held: boolean) {
    if (this.held === held) return
    this.held = held
    if (held) {
      this.setGate(false, 'held')
      this.player?.pauseVideo()
    } else if (this.visible && this.activeIndex !== null && this.activeIndex === this.loadedIndex && this.blockedIndex === null) {
      this.startLoaded('reconcile')
    }
  }

  isHeld() { return this.held }

  setVisible(visible: boolean) {
    if (this.visible === visible) return
    this.visible = visible
    if (!visible) {
      this.setGate(false, 'hidden')
      this.player?.pauseVideo()
    } else if (this.activeIndex !== null && this.activeIndex === this.loadedIndex && this.blockedIndex === null && this.playingIndex === null) {
      this.startLoaded('reconcile')
    }
  }

  // ---- gestures ----

  noteUserGesture() { this.lastGestureAt = performance.now() }

  private msSinceGesture() {
    return Number.isFinite(this.lastGestureAt) ? Math.round(performance.now() - this.lastGestureAt) : null
  }

  private msSinceScrollStart() {
    return this.scrollStartedAt === null ? null : Math.round(performance.now() - this.scrollStartedAt)
  }

  noteGestureEnd(type: string, context: Record<string, unknown> = {}) {
    diagnosticEvent('gestureEnd', { type, ...context, msSinceGesture: this.msSinceGesture(), msSinceScrollStart: this.msSinceScrollStart(), userActivation: userActivationSnapshot() })
  }

  // The decisive start tap, synchronously inside its handler (round 3
  // shape): bless the one player with video `index` and start it in
  // the same call stack.
  startFromGesture(index: number) {
    this.noteUserGesture()
    this.held = false
    if (!this.blessed) {
      this.blessed = true
      diagnosticEvent('singlePlayer', { action: 'blessing', source: 'start-gesture', index })
    }
    this.activeIndex = index
    this.switchTo(index, 'start-gesture')
  }

  // A genuine pointerdown retries a blocked start for the active item,
  // once per gesture (per-card core parity).
  handleUserGesture() {
    this.noteUserGesture()
    if (this.held) return
    if (this.activeIndex === null || !this.visible) return
    if (this.blockedIndex !== this.activeIndex) return
    if (this.gestureRetryStamp === this.lastGestureAt) return
    this.gestureRetryStamp = this.lastGestureAt
    this.blockedIndex = null
    if (this.loadedIndex === this.activeIndex) { this.startIssuedFor = null; this.startLoaded('gesture-retry') }
    else this.switchTo(this.activeIndex, 'gesture-retry')
  }

  // ---- scroll episodes and commits ----

  noteScrollStarted() {
    this.scrollStartedAt = performance.now()
    this.episodeOpen = true
    this.episodeCommittedIndex = null
    this.pendingActive = null
    this.setGate(false, 'scroll-start')
  }

  noteScrollEpisodeEnd() {
    if (!this.episodeOpen) return
    this.episodeOpen = false
    const pending = this.pendingActive
    this.pendingActive = null
    // A landing no commit claimed (the settle handler is the usual
    // claimant; this is the net underneath it): adopt the measured
    // landing now, outside any gesture — it may be blocked, and the
    // usual tap fallback remains.
    if (pending !== null && pending !== this.displayIndex) this.switchTo(pending, 'settle-commit')
    else if (pending !== null) this.activeIndex = pending
  }

  // Measure-driven active item. During an open scroll episode this
  // must NOT switch the source: the player layer still sits on the
  // outgoing card, and a mid-scroll switch would both show the wrong
  // video there and spend the switch outside the gesture-end handler
  // the memo requires. The landing is recorded and released by the
  // commit paths or by noteScrollEpisodeEnd.
  setActive(index: number | null) {
    if (index === null) {
      this.activeIndex = null
      this.pendingActive = null
      this.startIssuedFor = null
      this.player?.pauseVideo()
      return
    }
    const changed = index !== this.activeIndex
    this.activeIndex = index
    if (this.episodeOpen && this.episodeCommittedIndex !== index) {
      this.pendingActive = index
      return
    }
    this.pendingActive = null
    if (!changed && this.loadedIndex === index) return
    this.switchTo(index, 'reconcile')
  }

  // The swipe commit: VideoFeed calls this synchronously from its
  // gesture-end handler, and the unMute + loadVideoById below leave in
  // the same call stack — never deferred (memo §A: a deferred play
  // "never counts").
  commitSwipeTarget(index: number) {
    if (this.lastCommit?.index === index && this.lastCommit.episodeAt === this.scrollStartedAt) return
    if (this.held || !this.visible) return
    this.noteUserGesture()
    this.lastCommit = { index, episodeAt: this.scrollStartedAt }
    this.episodeCommittedIndex = index
    diagnosticEvent('swipeCommit', { index, msSinceScrollStart: this.msSinceScrollStart(), userActivation: userActivationSnapshot() })
    this.switchTo(index, 'touchend-commit')
  }

  // The settle commit: authoritative second chance (round 8 parity).
  // A target the gesture commit already switched is left alone —
  // unless its start was blocked, in which case settle retries it.
  commitSettleTarget(index: number) {
    if (this.held || !this.visible) return
    if (this.episodeCommittedIndex === index && this.loadedIndex === index && this.blockedIndex !== index) return
    if (this.lastCommit?.index === index && this.lastCommit.episodeAt === this.scrollStartedAt && this.blockedIndex !== index) return
    this.noteUserGesture()
    this.lastCommit = { index, episodeAt: this.scrollStartedAt }
    this.episodeCommittedIndex = index
    diagnosticEvent('settleCommit', { index, msSinceScrollStart: this.msSinceScrollStart(), userActivation: userActivationSnapshot() })
    if (this.blockedIndex === index && this.loadedIndex === index) {
      this.blockedIndex = null
      this.startIssuedFor = null
      this.startLoaded('settle-commit')
    } else {
      this.switchTo(index, 'settle-commit')
    }
  }

  // No mid-scroll early attempt in this architecture: the one player
  // switches at gesture end by design (see setActive).
  attemptEarlyStart(_index: number) { /* intentionally empty — see class comment */ }

  // ---- playback state from the component ----

  canPlay(index: number) { return !this.held && this.visible && this.activeIndex === index }

  private mayPlayCurrent() {
    return !this.held && this.visible && this.loadedIndex !== null && this.activeIndex === this.loadedIndex
  }

  // Explicit retry from the outside-player 「再生する」 button.
  play(index: number) {
    if (!this.canPlay(index)) return
    if (this.loadedIndex !== index) this.switchTo(index, 'explicit-play')
    else { this.blockedIndex = null; this.startIssuedFor = null; this.startLoaded('explicit-play') }
  }

  onStateChange(state: number) {
    const index = this.loadedIndex
    if (index === null || !this.player) return
    if (state === 1 || state === 3) {
      this.blockedIndex = null
      this.gestureRetryStamp = null
      this.playingIndex = index
      if (state === 1 && !this.blessed) {
        this.blessed = true
        diagnosticEvent('singlePlayer', { action: 'blessing', source: 'playing', index })
      }
      if (this.canPlay(index)) this.setGate(true, state === 1 ? 'playing' : 'buffering')
    }
    if (state === 2) {
      this.playingIndex = null
      this.startIssuedFor = null
      if (this.gateOpen) this.setGate(false, 'paused')
    }
    // Playback the coordinator did not authorize (late event after
    // navigating away, hold re-applied): pause it back.
    if ((state === 1 || state === 3) && !this.mayPlayCurrent()) this.player.pauseVideo()
    // Loop (round 5 parity): the settled active Short restarts at end.
    if (state === 0 && this.canPlay(index)) {
      this.player.seekTo(0, true)
      this.startIssuedFor = null
      this.startLoaded('loop')
    }
  }

  // YouTube refused a sound-on start for the loaded video. Record it
  // and — when the refusal lands inside a real gesture's window —
  // retry the identical request once for that gesture; otherwise the
  // 「再生する」 fallback (or the settle commit) owns the next try.
  // No muted substitute start is issued here.
  onAutoplayBlocked() {
    const index = this.loadedIndex
    if (index === null) return
    diagnosticEvent('autoplayBlocked', { index, msSinceGesture: this.msSinceGesture(), msSinceScrollStart: this.msSinceScrollStart(), userActivation: userActivationSnapshot() })
    diagnosticEvent('singlePlayer', { action: 'blocked', index, blessed: this.blessed })
    if (this.gateOpen) this.setGate(false, 'blocked')
    this.blockedIndex = index
    this.playingIndex = null
    this.startIssuedFor = null
    if (!this.canPlay(index)) return
    if (performance.now() - this.lastGestureAt > SinglePlaybackCoordinator.GESTURE_WINDOW_MS) return
    if (this.gestureRetryStamp === this.lastGestureAt) return
    this.gestureRetryStamp = this.lastGestureAt
    this.blockedIndex = null
    this.startLoaded('blocked-retry')
  }

  // ---- the switch itself ----

  private switchTo(index: number, reason: SwitchReason) {
    this.activeIndex = index
    this.setDisplayIndex(index)
    // Preparation hold: arm the target, never request playback —
    // startFromGesture issues the first start inside the decisive tap.
    if (this.held) { this.pendingSwitch = index; return }
    if (!this.player || index >= this.videos.length) { this.pendingSwitch = index; return }
    if (index !== this.loadedIndex) {
      this.loadedIndex = index
      this.blockedIndex = null
      this.playingIndex = null
      diagnosticEvent('singlePlayer', { action: 'switch', index, reason, blessed: this.blessed, msSinceScrollStart: this.msSinceScrollStart(), userActivation: userActivationSnapshot() })
      this.startLoaded(reason, true)
    } else if (this.blockedIndex === index) {
      this.blockedIndex = null
      this.startIssuedFor = null
      this.startLoaded(reason)
    } else if (this.startIssuedFor !== index) {
      this.startLoaded(reason)
    }
    // Otherwise a start for this video is already in flight and
    // nothing contradicted it: do not restart a playing video.
  }

  private startLoaded(reason: SwitchReason, load = false) {
    const index = this.loadedIndex
    const video = index === null ? undefined : this.videos[index]
    if (!this.player || index === null || !video) return
    countPlayerWork('playRequests')
    diagnosticEvent('playRequest', { index, reason, msSinceGesture: this.msSinceGesture(), msSinceScrollStart: this.msSinceScrollStart(), userActivation: userActivationSnapshot() })
    // Sound on for every start, exactly like the per-card core; the
    // browser may still refuse, which surfaces via onAutoplayBlocked.
    this.player.unMute()
    if (load) this.player.loadVideoById(video.externalVideoId)
    else this.player.playVideo()
    this.startIssuedFor = index
  }
}
