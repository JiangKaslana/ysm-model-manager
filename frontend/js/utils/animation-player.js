import { evaluateClip } from "./animation.js";

export class AnimationPlayer {
  constructor(clips = [], boneHierarchy = null, options = {}) {
    this.clips = clips;
    this._boneHierarchy = boneHierarchy;
    this._localOnly = !!options.localOnly;
    this._currentIndex = -1;
    this._time = 0;
    this._speed = 1;
    this._playing = false;
    this._lastTimestamp = 0;
    this._rafId = null;
    this._currentTransforms = null;
    this._variables = options.variables || {};

    this.onUpdate = null;
    this.onStop = null;
  }

  get currentClip() {
    return this._currentIndex >= 0 ? this.clips[this._currentIndex] : null;
  }

  get currentIndex() {
    return this._currentIndex;
  }

  get time() {
    return this._time;
  }

  get playing() {
    return this._playing;
  }

  get speed() {
    return this._speed;
  }

  get length() {
    return this.currentClip?.length || 0;
  }

  get hasAnimations() {
    return this.clips.length > 0;
  }

  get clipNames() {
    return this.clips.map((c) => c.name);
  }

  play(index, startTime = 0) {
    if (index < 0 || index >= this.clips.length) {
      this.stop();
      return;
    }
    this._currentIndex = index;
    this._time = startTime;
    this._playing = true;
    this._lastTimestamp = performance.now();
    this._tick();
    this._scheduleRAF();
  }

  stop() {
    this._playing = false;
    this._cancelRAF();
    this._currentTransforms = null;
    this.onStop?.({ hold: false });
  }

  pause() {
    this._playing = false;
    this._cancelRAF();
  }

  resume() {
    if (this._currentIndex < 0) return;
    this._playing = true;
    this._lastTimestamp = performance.now();
    this._scheduleRAF();
  }

  setSpeed(s) {
    this._speed = Math.max(0.1, Math.min(10, s));
  }

  setVariables(vars = {}) {
    this._variables = vars || {};
    this._tick();
  }

  seek(t) {
    const clip = this.currentClip;
    if (!clip) return;
    this._time = clip.loop
      ? ((t % clip.length) + clip.length) % clip.length
      : Math.max(0, Math.min(t, clip.length));
    this._tick();
  }

  prevClip() {
    if (this.clips.length === 0) return;
    const i =
      this._currentIndex <= 0 ? this.clips.length - 1 : this._currentIndex - 1;
    this.play(i);
  }

  nextClip() {
    if (this.clips.length === 0) return;
    const i =
      this._currentIndex >= this.clips.length - 1 ? 0 : this._currentIndex + 1;
    this.play(i);
  }

  getCurrentTransforms() {
    return this._currentTransforms;
  }

  _scheduleRAF() {
    this._cancelRAF();
    this._rafId = requestAnimationFrame((ts) => this._loop(ts));
  }

  _cancelRAF() {
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }

  _loop(timestamp) {
    if (!this._playing) return;

    const dt = Math.min((timestamp - this._lastTimestamp) / 1000, 0.1);
    this._lastTimestamp = timestamp;
    if (this._speed > 0) this._time += dt * this._speed;

    const clip = this.currentClip;
    if (clip && !clip.loop && this._time >= clip.length) {
      this._time = clip.length;
      this._tick();
      if (clip.loopType === "hold_on_last_frame") {
        this.pause();
        this.onStop?.({ hold: true });
        return;
      }
      this.stop();
      return;
    }

    this._tick();
    this._scheduleRAF();
  }

  _tick() {
    const clip = this.currentClip;
    if (!clip) {
      this._currentTransforms = null;
      return;
    }
    const displayTime =
      clip.loop && clip.length > 0
        ? ((this._time % clip.length) + clip.length) % clip.length
        : Math.min(this._time, clip.length);
    this._currentTransforms = evaluateClip(
      clip,
      this._time,
      this._boneHierarchy,
      this._localOnly,
      { variables: this._variables },
    );
    this.onUpdate?.(this._currentTransforms, displayTime, clip);
  }
}
