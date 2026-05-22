import { rowInfo } from './audio/song.js';

// The demo director: owns the master clock + tracker, drives the timeline, and
// derives music-synced signals (beat, kick energy, pattern-change flash) that
// effects read from the per-frame `ctx`.
//
// The timeline is a sequence of *parts* (an effect is scheduled over a beat
// window [startBeat, endBeat)). Layered effects share a window (e.g. the intro's
// starfield + scroller). The timeline loops every `loopBeats` beats, so the
// production runs forever; beat windows are matched against the looped
// `localBeat` while animation keeps reading the continuously-rising `beat`.
//
// Between parts the director runs a *transition* anchored on a musical boundary
// (a pattern change). A transition fades the framebuffer down through the
// palette to black (or sweeps a shutter wipe), the parts swap while the screen
// is black, then it fades/sweeps back up. The framebuffer reads the resulting
// {fade, wipe} amounts from `ctx.transition`, so cuts always land on the beat
// and never pop.

// Half-lengths of a transition, in beats: fade/wipe out for OUT beats up to the
// boundary, then in for IN beats after it. Total seam length = OUT + IN.
const TRANS_OUT = 1.5;
const TRANS_IN = 1.5;

export class Director {
	constructor(song, clock, tracker) {
		this.song = song;
		this.clock = clock;
		this.tracker = tracker;
		this.secPerRow = 60 / song.bpm / song.rowsPerBeat;

		this.entries = [];     // { effect, startBeat, endBeat }
		this.seams = [];       // { beat, type } transition markers on the loop
		this.loopBeats = Infinity;
		this.endBeat = Infinity; // beat at which the production finishes (no loop)
		this.active = [];
		this.started = false;
		this._fadeScheduled = false; // master-gain fade-out armed once, near the end
		this._ended = false;         // tracker stopped once, past the end

		this.lastRow = -1;
		this.energy = 0;       // decays after each kick (0..1)
		this.flash = 0;        // decays after each pattern change (0..1)
	}

	// Schedule an effect over the beat window [startBeat, endBeat). `endBeat`
	// defaults to "never ends". Effects sharing a window are layered in the order
	// they are added (first = background, drawn first).
	add(effect, startBeat, endBeat = Infinity) {
		effect.startBeat = startBeat;
		this.entries.push({ effect, startBeat, endBeat });
	}

	// Mark a transition on the looping timeline at `beat` (must be a musical
	// boundary). `type` is 'fade' (through the palette) or 'wipe' (shutter).
	addSeam(beat, type = 'fade') {
		this.seams.push({ beat, type });
	}

	// Length of one full pass of the timeline, after which it loops.
	setLoop(loopBeats) {
		this.loopBeats = loopBeats;
	}

	// Finish the production at `beat` instead of looping: the master volume rides
	// down over the final transition and the tune stops once we pass it, so the
	// demo plays straight through and then ends on black + silence. Leave unset
	// (the default) to run forever. Mutually exclusive with setLoop.
	setEnd(beat) {
		this.endBeat = beat;
	}

	// Begin the production: open the audio context (must be in a user gesture),
	// anchor the clock, and start the tune. Visuals were frozen until now.
	start() {
		if (this.started) return;
		this.started = true;

		const AC = window.AudioContext || window.webkitAudioContext;
		this.audioCtx = new AC();
		this.audioCtx.resume();

		const t0 = this.audioCtx.currentTime + 0.08; // tiny safety margin
		this.clock.start(this.audioCtx);
		this.tracker.start(this.audioCtx, t0);
	}

	// Compute the transition state at looped beat `lb`. Returns the fade amount
	// (0 visible -> 1 black) and wipe amount (-1 inactive, else 0..1 black rows).
	// Each seam contributes an OUT ramp just before it and an IN ramp just after;
	// we test the seam's beat plus its two loop-wrapped copies so a seam sitting
	// on the loop point (e.g. beat == loopBeats) works at both ends.
	transition(lb) {
		const L = this.loopBeats;
		for (const s of this.seams) {
			const copies = isFinite(L) ? [s.beat - L, s.beat, s.beat + L] : [s.beat];
			for (const c of copies) {
				if (lb >= c - TRANS_OUT && lb < c) {
					return this._mk(s.type, (lb - (c - TRANS_OUT)) / TRANS_OUT);
				}
				if (lb >= c && lb < c + TRANS_IN) {
					return this._mk(s.type, 1 - (lb - c) / TRANS_IN);
				}
			}
		}
		return { fade: 0, wipe: -1 };
	}

	// amount: 0 = fully visible, 1 = fully black.
	_mk(type, amount) {
		if (type === 'wipe') return { fade: 0, wipe: amount };
		return { fade: amount, wipe: -1 };
	}

	// Advance one frame. `dt` is real elapsed seconds (smooth animation);
	// musical time comes from the clock so it stays locked to the tune.
	tick(dt) {
		const time = this.clock.now();
		const rowFloat = time / this.secPerRow;
		const beat = rowFloat / this.song.rowsPerBeat;
		const row = Math.floor(rowFloat);
		const localBeat = isFinite(this.loopBeats) ? beat % this.loopBeats : beat;

		// Fire discrete events when we cross into a new row.
		if (this.started && row !== this.lastRow && row >= 0) {
			const info = rowInfo(this.song, row);
			if (info.kick) this.energy = 1;
			if (info.isPatternStart && row > 0) this.flash = 1;
			this.lastRow = row;
			this._patternIndex = info.patternIndex;
		}

		// Exponential decay of the transient signals.
		this.energy *= Math.exp(-dt * 6);
		this.flash *= Math.exp(-dt * 5);

		// Ending (when setEnd is in effect). The final seam fades the picture to
		// black over TRANS_OUT beats before endBeat; we ride the master gain down
		// across the same window so the music fades with it, then stop the tracker
		// once we cross the line so the production ends in silence on black.
		if (this.started && isFinite(this.endBeat)) {
			if (!this._fadeScheduled && beat >= this.endBeat - TRANS_OUT) {
				this._fadeScheduled = true;
				const g = this.tracker.master && this.tracker.master.gain;
				if (g) {
					const now = this.audioCtx.currentTime;
					const secsLeft = Math.max(0.05, ((this.endBeat - beat) * 60) / this.song.bpm);
					g.cancelScheduledValues(now);
					g.setValueAtTime(g.value, now);
					g.linearRampToValueAtTime(0.0001, now + secsLeft);
				}
			}
			if (!this._ended && beat >= this.endBeat) {
				this._ended = true;
				this.tracker.stop();
			}
		}

		const ctx = {
			time,
			dt,
			beat,
			localBeat,
			rowFloat,
			energy: this.energy,
			flash: this.flash,
			patternIndex: this._patternIndex || 0,
			transition: this.transition(localBeat),
		};

		this.active = this.entries
			.filter((e) => localBeat >= e.startBeat && localBeat < e.endBeat)
			.map((e) => e.effect);
		for (const e of this.active) e.update(ctx);

		return ctx;
	}
}
