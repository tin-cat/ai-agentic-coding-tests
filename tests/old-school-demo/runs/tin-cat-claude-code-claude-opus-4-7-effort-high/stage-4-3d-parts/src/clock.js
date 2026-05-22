// A single master clock that both the visuals and the audio scheduler agree on.
//
// Visuals read time from `performance.now()` (smooth, per-frame). The audio
// scheduler needs times on the WebAudio timeline (`AudioContext.currentTime`).
// We anchor both at the same instant in `start()`, so a given demo-second `s`
// maps to `audioT0 + s` on the audio clock. Over the length of a demo the two
// clocks drift by a sub-millisecond amount, which is inaudible/invisible.

export class Clock {
	constructor() {
		this.t0 = 0;        // performance.now() seconds at start
		this.audioT0 = 0;   // AudioContext.currentTime at start
		this.running = false;
	}

	// Anchor the timeline. `audioCtx` is optional (visual-only previews).
	start(audioCtx) {
		this.t0 = performance.now() / 1000;
		this.audioT0 = audioCtx ? audioCtx.currentTime : 0;
		this.running = true;
	}

	// Seconds since start. Frozen at 0 until the demo is started.
	now() {
		return this.running ? performance.now() / 1000 - this.t0 : 0;
	}

	// Convert a demo-second into a time on the AudioContext clock.
	toAudioTime(s) {
		return this.audioT0 + s;
	}
}
