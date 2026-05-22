import { rowInfo } from './audio/song.js';

// The demo director: owns the master clock + tracker, drives the timeline, and
// derives music-synced signals (beat, kick energy, pattern-change flash) that
// effects read from the per-frame `ctx`.
//
// Effects are scheduled to enter at a given beat. Each frame we build the list
// of active effects (in insertion order = render/layer order), update them, and
// hand them back to be rendered into the framebuffer.

export class Director {
	constructor(song, clock, tracker) {
		this.song = song;
		this.clock = clock;
		this.tracker = tracker;
		this.secPerRow = 60 / song.bpm / song.rowsPerBeat;

		this.entries = [];     // { effect, startBeat }
		this.active = [];
		this.started = false;

		this.lastRow = -1;
		this.energy = 0;       // decays after each kick (0..1)
		this.flash = 0;        // decays after each pattern change (0..1)
	}

	// Schedule an effect to appear at `startBeat` and persist (loops forever).
	add(effect, startBeat) {
		effect.startBeat = startBeat;
		this.entries.push({ effect, startBeat });
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

	// Advance one frame. `dt` is real elapsed seconds (smooth animation);
	// musical time comes from the clock so it stays locked to the tune.
	tick(dt) {
		const time = this.clock.now();
		const rowFloat = time / this.secPerRow;
		const beat = rowFloat / this.song.rowsPerBeat;
		const row = Math.floor(rowFloat);

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

		const ctx = {
			time,
			dt,
			beat,
			rowFloat,
			energy: this.energy,
			flash: this.flash,
			patternIndex: this._patternIndex || 0,
		};

		this.active = this.entries
			.filter((e) => beat >= e.startBeat)
			.map((e) => e.effect);
		for (const e of this.active) e.update(ctx);

		return ctx;
	}
}
