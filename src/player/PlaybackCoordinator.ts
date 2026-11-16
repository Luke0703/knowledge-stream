import { countPlayerWork, diagnosticEvent, userActivationSnapshot } from './diagnostics'
import type { FeedCoordinator } from './FeedCoordinator'
export type PlayerControl = Pick<YT.Player, 'pauseVideo' | 'playVideo' | 'mute' | 'unMute' | 'seekTo'>
// Why a play request was issued, recorded in diagnostics so a device
// session can tell the round-4 early (mid-scroll) attempt apart from the
// settle-time one and from the older gesture paths.
type PlayRequestReason = 'reconcile' | 'register' | 'start-gesture' | 'blocked-retry' | 'gesture-retry' | 'explicit-play' | 'early-threshold' | 'loop' | 'touchend-commit' | 'settle-commit'

// One synchronous authority: pause old players before starting a new one.
// React state/async onReady callbacks are not trusted as playback eligibility.
export class PlaybackCoordinator implements FeedCoordinator {
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
  // Round 4 (2026-11-10): the entering item a swipe is bringing in, once
  // it passed the feed's early threshold. It receives ONE sound-on play
  // attempt while the scroll is still moving — timed to the transient
  // activation the touch leaves inside the YouTube iframe itself, which
  // the settle-time request (rounds 1–3) arrived too late to use. Until
  // the scroll settles, this player counts as playable so neither the
  // mid-scroll setActive(null) nor its own playing state event pauses it
  // again. Settling onto it promotes it to active; settling anywhere
  // else abandons it. earlyPlaying records that the attempt actually
  // reached playback/buffering, so promotion does not issue a duplicate.
  private earlyIndex: number | null = null
  private earlyPlaying = false
  // Start of the current scroll episode, stamped by the feed, so
  // diagnostics can place each attempt on the swipe's own clock.
  private scrollStartedAt: number | null = null
  // Round 6 (2026-11-11) + Round 7 (2026-11-13): the last commit issued
  // for a scroll episode, keyed by the episode it belonged to — from the
  // gesture-end handler (round 6) or from the scroll-settle handler
  // (round 7). One physical gesture can surface as several end events
  // (pointerup AND touchend, on some browsers also a cancel), and the
  // settle detection can fire after the gesture end; the commit for an
  // episode must happen exactly once, whichever path reaches it first.
  // A later episode re-stamps scrollStartedAt, so the key stops matching
  // and the next swipe may commit again. This reuses the episode stamp
  // the feed already maintains for diagnostics instead of adding a
  // parallel gesture counter.
  private lastCommit: { index: number; episodeAt: number | null } | null = null
  // Round 9 (2026-11-14): the pointer-events gate. Rounds 6–8 proved the
  // gesture-end commit never fires on a real iPhone because the swipe's
  // touch is captured inside the YouTube iframe: pointerup / touchend
  // never reach the parent document. Round 9 removes the capture at its
  // source by switching the IFRAME ELEMENT's OWN pointer-events
  // property — never an overlay above the player (AGENTS.md forbids
  // invisible touch layers over the player; nothing is layered here,
  // the iframe itself simply stops taking pointer events):
  // - 'none' (gate closed) is the default for every card, and is
  //   re-applied to all cards when a new scroll episode starts, so a
  //   swipe that begins on a not-yet-playing card delivers its touch
  //   stream — including the gesture end — to the parent document,
  //   where the round-6 commit can fire inside the genuine handler.
  // - 'auto' (gate open) is granted to exactly one card: the settled
  //   active one, once its player actually reports playing/buffering,
  //   so YouTube's official UI stays fully usable on the video being
  //   watched. It closes again on the next scroll start, on pause, on
  //   an autoplay block, when the active item changes, when the
  //   document hides, under the preparation hold, and on unregister.
  // A closed gate after a snap-back reopens at that player's next
  // playing/buffering state event; until then the outside controls
  // remain, and closed is the safe default for the next swipe.
  private gateIndex: number | null = null
  private gateListeners = new Set<() => void>()

  // Round 9: whether this card's iframe may receive pointer events
  // (YouTube's official UI). See the gate comment at gateIndex.
  isIframeInteractive(index: number) { return this.gateIndex === index }

  subscribeGate(listener: () => void) {
    this.gateListeners.add(listener)
    return () => { this.gateListeners.delete(listener) }
  }

  private setGate(index: number | null, reason: string) {
    if (this.gateIndex === index) return
    const previous = this.gateIndex
    this.gateIndex = index
    // Round 9 diagnostics: every gate switch is recorded, so a device
    // session can separate "the gate was closed, so the parent could
    // receive the touch" from "the gate was open (playing video) and
    // the iframe kept the touch as before".
    if (previous !== null) diagnosticEvent('pointerGate', { index: previous, interactive: false, reason, msSinceScrollStart: this.msSinceScrollStart(), userActivation: userActivationSnapshot() })
    if (index !== null) diagnosticEvent('pointerGate', { index, interactive: true, reason, msSinceScrollStart: this.msSinceScrollStart(), userActivation: userActivationSnapshot() })
    for (const listener of [...this.gateListeners]) listener()
  }

  setActive(index: number | null) {
    if (this.active === index) return
    if (index !== this.gateIndex) this.setGate(null, 'active-change')
    // Settling onto the early-attempted item promotes it; if its early
    // attempt already reached playback, the settle reconcile must not
    // re-issue the request. Settling on anything else abandons the
    // early attempt, and reconcile pauses that player again.
    const promotedAndPlaying = index !== null && index === this.earlyIndex && this.earlyPlaying
    this.active = index
    if (index !== null) this.clearEarly()
    this.reconcile(promotedAndPlaying ? index : null)
  }

  setVisible(visible: boolean) {
    if (this.visible === visible) return
    this.visible = visible
    if (!visible) { this.clearEarly(); this.setGate(null, 'hidden') }
    this.reconcile()
  }

  register(index: number, player: PlayerControl) {
    this.players.set(index, player)
    diagnosticEvent('playerReady', { index, held: this.held, msSinceGesture: this.msSinceGesture() })
    if (this.mayPlay(index)) this.start(index, player, 'register')
    else player.pauseVideo()
    this.notifyReadyListeners()
  }

  unregister(index: number, player: PlayerControl) {
    if (this.gateIndex === index) this.setGate(null, 'unregister')
    if (this.players.get(index) === player) this.players.delete(index)
    this.blockedByAutoplay.delete(index)
    this.gestureRetryStamp.delete(index)
    if (this.earlyIndex === index) this.clearEarly()
    player.pauseVideo()
    this.notifyReadyListeners()
  }

  // Preparation hold control. setHeld(false) on its own only lifts the
  // hold and reconciles; the start screen uses startFromGesture() so the
  // first play request stays inside the decisive tap's handler.
  setHeld(held: boolean) {
    if (this.held === held) return
    this.held = held
    if (held) { this.clearEarly(); this.setGate(null, 'held') }
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

  private msSinceScrollStart() {
    return this.scrollStartedAt === null ? null : Math.round(performance.now() - this.scrollStartedAt)
  }

  // The feed stamps the first scroll event of each scroll episode, so
  // diagnostics can report how far into the swipe each play attempt was
  // issued (round 4's hypothesis lives or dies by that timing).
  noteScrollStarted() {
    this.scrollStartedAt = performance.now()
    // Round 9: a new scroll episode closes every gate, including the
    // playing video's, so the swipe's remaining events target the
    // parent document instead of the iframe under the finger.
    this.setGate(null, 'scroll-start')
  }

  // FeedCoordinator parity (round 10): this core keys its commits off
  // the episode stamp (scrollStartedAt) and needs no explicit episode
  // close; SinglePlaybackCoordinator uses the call to release a
  // landing no commit claimed. No-op here by design.
  noteScrollEpisodeEnd() {}

  // Round 9 diagnostics: the feed reports EVERY gesture-end event it
  // receives (pointerup / pointercancel / touchend / touchcancel)
  // before any dedupe, stamped with the timing and activation the
  // parent held at that moment. Rounds 6–8 could not distinguish "the
  // event never arrived" from "it arrived but the request was
  // blocked"; the panel now shows gestureEnd entries directly, and a
  // session with no gestureEnd at all after a swipe means the touch
  // stream still never reached the parent.
  noteGestureEnd(type: string, context: Record<string, unknown> = {}) {
    diagnosticEvent('gestureEnd', { type, ...context, msSinceGesture: this.msSinceGesture(), msSinceScrollStart: this.msSinceScrollStart(), userActivation: userActivationSnapshot() })
  }

  private clearEarly() {
    this.earlyIndex = null
    this.earlyPlaying = false
  }

  // Playable means the settled active item, or — during one approach —
  // the early-attempted entering item. The preparation hold and a hidden
  // document veto both.
  private mayPlay(index: number) {
    return this.canPlay(index) || (!this.held && this.visible && index === this.earlyIndex)
  }

  // Round 4's single early attempt. Called by the feed when an entering
  // item that is not (yet) the active one first fills the early share of
  // the viewport, i.e. while the swipe that carries the touch's
  // transient activation inside the YouTube iframe is still moving —
  // not after the scroll settles, which rounds 1–3 showed is too late.
  // One attempt per approach: the coordinator remembers the item until
  // the scroll settles on it (promotion), settles elsewhere, or the
  // player goes away. If the attempt is blocked, the settle reconcile
  // issues the one remaining try; if it plays, promotion skips the
  // duplicate. No synthetic gestures are involved: this is the identical
  // unMute + playVideo request, only issued earlier.
  attemptEarlyStart(index: number) {
    if (this.held || !this.visible) return
    if (index === this.active || index === this.earlyIndex) return
    const player = this.players.get(index)
    if (!player) return // Not ready yet; the feed re-calls this on later measures of the same approach.
    this.earlyIndex = index
    this.earlyPlaying = false
    for (const [other, otherPlayer] of this.players) if (other !== index) otherPlayer.pauseVideo()
    this.blockedByAutoplay.delete(index)
    diagnosticEvent('earlyPlayAttempt', { index, msSinceScrollStart: this.msSinceScrollStart(), userActivation: userActivationSnapshot() })
    this.start(index, player, 'early-threshold')
  }

  // Round 6 (2026-11-11): the swipe commit, called synchronously from
  // the gesture-end handler (pointerup / touchend) while that genuine
  // gesture's transient activation is still alive in the parent
  // document — the same proven shape as the start tap and the prev/next
  // buttons (round 3), whose requests the browsers accept, unlike
  // settle-time requests issued after the snap animation ends.
  //
  // Round 7 (2026-11-13): the same commit, called from the scroll-settle
  // handler instead. On a real iPhone the gesture-end path never fires —
  // the YouTube iframe captures the touch, so the parent never sees
  // pointerup/touchend (verified 2026-11-13: swipeCommit 0 of 11 events
  // on device) — and the scroll stopping is the only reliable
  // "the swipe finished" signal the parent can see. The settle commit's
  // request is issued after the gesture, so it may still be blocked;
  // the bet is the round-4 early attempt, fired mid-scroll inside the
  // iframe's own activation, so the settle commit mostly promotes or
  // keeps that playback instead of starting from cold. No synthetic
  // gesture is involved either way: this is the identical unMute +
  // playVideo request, issued at gesture end or at settle.
  //
  // Bookkeeping, deliberately shared with the existing paths:
  // - One commit per scroll episode and target (see lastCommit):
  //   the several end events of one physical gesture, and the settle
  //   detection firing after them, do not re-issue. Whichever path
  //   reaches the commit first wins.
  // - The commit spends this gesture's retry entitlement up front
  //   (gestureRetryStamp), so if the committed request is itself
  //   blocked, the block is recorded and waits for the NEXT genuine
  //   gesture instead of instantly re-firing through the gesture-window
  //   retry — the committed request already WAS this gesture's try.
  // - The target becomes active immediately and is also marked as the
  //   early item, so it stays playable through the remaining snap
  //   motion: intermediate measures that report no active item must not
  //   pause what the commit just started, and the settle measure's
  //   setActive(same index) is a no-op — no duplicate request.
  //   If the snap lands elsewhere after all, that setActive clears the
  //   marker and reconcile pauses the committed player again.
  //
  // Round 9 (2026-11-14): the gesture-end commit is revived, with its
  // round-6 failure addressed at the source. The device verdict on
  // round 6 was that the end events never reached this handler at all
  // (the iframe kept the touch). The pointer-events gate above now
  // closes every not-yet-playing card's iframe, so a swipe that starts
  // on such a card delivers pointerup / touchend to the parent and
  // this commit can fire inside that genuine handler — the proven
  // round-3 shape. The settle commit below stays as the second chance
  // for swipes that begin on the one gate-open (playing) card, whose
  // first touch the iframe may still keep. Feed-side, every received
  // end event is also logged (noteGestureEnd) before dedupe, so a
  // device session can finally separate arrival from acceptance.
  //
  // Round 8 (2026-11-14): the settle commit is authoritative even when
  // the target is ALREADY the active item. The round-7 device session
  // showed settleCommit firing 0 times: the feed's measure activates
  // the entering card mid-scroll (its reconcile start is the attempt
  // the panel recorded), setActive clears the early marker, and when
  // that start is blocked the card sits active in blockedByAutoplay —
  // so the "already the settled item" early return below swallowed
  // every settle commit and the settle moment never got an attempt of
  // its own. A settle commit for an active-but-blocked target now
  // falls through to the shared body: it stamps the episode's one
  // commit, emits settleCommit, clears the blocked mark and issues a
  // fresh start with reason 'settle-commit'. An active target that is
  // NOT blocked (its start went through) still returns early — there
  // is nothing to commit — and the gesture-end path keeps the old
  // return unconditionally: its moment is inside the gesture, where
  // the reconcile attempt has not necessarily resolved yet.
  commitSwipeTarget(index: number) {
    this.commitTarget(index, 'touchend-commit')
  }

  commitSettleTarget(index: number) {
    this.commitTarget(index, 'settle-commit')
  }

  private commitTarget(index: number, kind: 'touchend-commit' | 'settle-commit') {
    if (this.lastCommit?.index === index && this.lastCommit.episodeAt === this.scrollStartedAt) return
    if (this.held || !this.visible) return
    if (index === this.active && this.earlyIndex !== index) {
      // Already the settled item: nothing to commit — UNLESS this is a
      // settle commit and the item's start was blocked (round 8: the
      // settle moment is then the authoritative retry, see above).
      if (kind !== 'settle-commit' || !this.blockedByAutoplay.has(index)) return
    }
    this.noteUserGesture()
    this.lastCommit = { index, episodeAt: this.scrollStartedAt }
    diagnosticEvent(kind === 'touchend-commit' ? 'swipeCommit' : 'settleCommit', { index, msSinceScrollStart: this.msSinceScrollStart(), userActivation: userActivationSnapshot() })
    if (index === this.earlyIndex && this.earlyPlaying) {
      // The round-4 early attempt for this same target already reached
      // playback/buffering: promote it without a duplicate request,
      // exactly like a settle landing would.
      this.active = index
      this.clearEarly()
      for (const [other, otherPlayer] of this.players) if (other !== index) otherPlayer.pauseVideo()
      return
    }
    this.active = index
    this.earlyIndex = index
    this.earlyPlaying = false
    this.gestureRetryStamp.set(index, this.lastGestureAt)
    for (const [other, otherPlayer] of this.players) if (other !== index) otherPlayer.pauseVideo()
    const player = this.players.get(index)
    if (player) {
      this.blockedByAutoplay.delete(index)
      this.start(index, player, kind)
    }
    // Not ready yet: the markers above arm the target, and register()
    // issues the request when the player arrives (it may still be
    // blocked then; the usual 「再生する」 fallback remains).
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
    this.clearEarly() // A decisive tap supersedes any in-flight early attempt.
    this.active = index
    for (const [other, player] of this.players) if (other !== index) player.pauseVideo()
    const player = this.players.get(index)
    if (player && this.visible) {
      this.blockedByAutoplay.delete(index)
      this.start(index, player, 'start-gesture')
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
    diagnosticEvent('autoplayBlocked', { index, msSinceGesture: this.msSinceGesture(), msSinceScrollStart: this.msSinceScrollStart(), userActivation: userActivationSnapshot() })
    // Round 9: a blocked card is by definition not playing, so its
    // gate (if it was somehow open) closes — the next touch on it
    // belongs to the parent, where a genuine tap can retry.
    if (this.gateIndex === index) this.setGate(null, 'blocked')
    this.blockedByAutoplay.add(index)
    // A block of the early (mid-scroll) attempt is only recorded here:
    // canPlay is false for it until it settles, and the settle reconcile
    // then issues the one remaining try. It must not fall into the
    // gesture-window retry below, which would spend that try early.
    if (!this.canPlay(index)) return
    const gestureAt = this.lastGestureAt
    if (performance.now() - gestureAt > PlaybackCoordinator.GESTURE_WINDOW_MS) return
    if (this.gestureRetryStamp.get(index) === gestureAt) return
    const player = this.players.get(index)
    if (!player) return
    this.gestureRetryStamp.set(index, gestureAt)
    this.blockedByAutoplay.delete(index)
    this.start(index, player, 'blocked-retry')
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
    this.start(this.active, player, 'gesture-retry')
  }

  canPlay(index: number) { return !this.held && this.visible && this.active === index }

  // Explicit retry from an outside-player button after autoplay was blocked.
  play(index: number) {
    if (!this.canPlay(index)) return
    const player = this.players.get(index)
    if (player) this.start(index, player, 'explicit-play')
  }

  onStateChange(index: number, player: PlayerControl, state: number) {
    // Playback or buffering actually began: any earlier autoplay block for
    // this player is history, so gestures must not restart it afterwards.
    if (state === 1 || state === 3) {
      this.blockedByAutoplay.delete(index)
      this.gestureRetryStamp.delete(index)
      // The early attempt worked: promotion at settle must not duplicate it.
      if (index === this.earlyIndex) this.earlyPlaying = true
      // Round 9: the settled active player that is actually playing
      // (or buffering towards it) earns its iframe back — YouTube's
      // official UI becomes usable on the watched video. An early
      // (not yet settled) player does NOT open: it is not settled, and
      // its iframe must keep passing the swipe's touches to the
      // parent until the navigation is decided.
      if (this.canPlay(index)) this.setGate(index, state === 1 ? 'playing' : 'buffering')
    }
    // A deliberate pause via YouTube's own UI closes the gate again:
    // the card is no longer playing, so the next touch on it goes to
    // the parent (the outside 「再生する」 can restart it). ENDED
    // (state 0) keeps the gate: round 5's loop restarts immediately
    // and its playing/buffering event re-confirms the gate anyway.
    if (state === 2 && this.gateIndex === index) this.setGate(null, 'paused')
    // Includes unexpected/manual playback or a late buffering event after navigation.
    // The early-attempted entering player is exempt: starting mid-scroll is its purpose.
    if ((state === 1 || state === 3) && !this.mayPlay(index)) player.pauseVideo()
    // Loop (round 5, 2026-11-10, user request): these are Shorts, so the
    // settled active video restarts from the beginning when it ends,
    // like the native Shorts player. Only the playable active item
    // loops; an ENDED arriving for any other player is ignored. The
    // restart is the identical sound-on request (reason 'loop'); whether
    // the browser honours it without a fresh gesture is a real-device
    // question, and a refusal surfaces through the usual blocked path.
    if (state === 0 && this.canPlay(index)) {
      player.seekTo(0, true)
      this.start(index, player, 'loop')
    }
  }

  private start(index: number, player: PlayerControl, reason: PlayRequestReason) {
    countPlayerWork('playRequests')
    diagnosticEvent('playRequest', { index, reason, msSinceGesture: this.msSinceGesture(), msSinceScrollStart: this.msSinceScrollStart(), userActivation: userActivationSnapshot() })
    // Explicit product choice: request sound on for each new play request.
    // The browser can still reject sound-on playback; do not fake user activation.
    player.unMute()
    player.playVideo()
  }

  private reconcile(skipStartFor: number | null = null) {
    if (this.held) {
      // Preparation phase: keep every prepared player paused and never
      // issue a play request, so no autoplay block is generated before
      // the decisive tap.
      for (const [, player] of this.players) player.pauseVideo()
      return
    }
    for (const [index, player] of this.players) if (!this.mayPlay(index)) player.pauseVideo()
    if (this.active !== null && this.visible && this.active !== skipStartFor) {
      const player = this.players.get(this.active)
      if (player) this.start(this.active, player, 'reconcile')
    }
  }
}
