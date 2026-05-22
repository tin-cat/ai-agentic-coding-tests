// A tiny tracker-style playback engine built on the Web Audio API. It plays the
// SONG on a loop using a lookahead scheduler (the standard "two clocks" pattern:
// a coarse setInterval wakes us up, and we schedule note events precisely on the
// AudioContext clock a little ahead of time).
//
// Channels are voiced with oscillators + gain envelopes (bass/arp/lead) and
// noise bursts (drums), which gives the multi-channel, sample-ish texture of
// era tracker music without shipping any sample data.

const NOTE_SEMITONES = {
	C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5,
	'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11,
};

function noteFreq(name) {
	const m = /^([A-G]#?)(-?\d)$/.exec(name);
	const midi = (parseInt(m[2], 10) + 1) * 12 + NOTE_SEMITONES[m[1]];
	return 440 * Math.pow(2, (midi - 69) / 12);
}

export class Tracker {
	constructor(song) {
		this.song = song;
		this.secPerRow = 60 / song.bpm / song.rowsPerBeat;
		this.lookahead = 0.12; // schedule this far ahead, seconds
		this.tickMs = 25;
		this.ctx = null;
		this.timer = null;
	}

	// `t0` is the AudioContext time at which row 0 should sound.
	start(audioCtx, t0) {
		this.ctx = audioCtx;

		this.master = audioCtx.createGain();
		this.master.gain.value = 0.3;
		this.master.connect(audioCtx.destination);

		// One second of white noise reused for every drum hit.
		const len = audioCtx.sampleRate;
		this.noise = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
		const d = this.noise.getChannelData(0);
		for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

		this.rowAbs = 0;
		this.nextTime = t0;
		this.timer = setInterval(() => this._schedule(), this.tickMs);
	}

	stop() {
		if (this.timer) clearInterval(this.timer);
		this.timer = null;
	}

	_schedule() {
		const ahead = this.ctx.currentTime + this.lookahead;
		while (this.nextTime < ahead) {
			this._playRow(this.rowAbs, this.nextTime);
			this.rowAbs++;
			this.nextTime += this.secPerRow;
		}
	}

	_playRow(rowAbs, time) {
		const s = this.song;
		const oi = Math.floor(rowAbs / s.rows) % s.order.length;
		const p = s.patterns[s.order[oi]];
		const r = rowAbs % s.rows;

		if (p.bass[r]) this._voice('bass', p.bass[r], time);
		if (p.arp[r]) this._voice('arp', p.arp[r], time);
		if (p.lead && p.lead[r]) this._voice('lead', p.lead[r], time);
		for (const ch of (p.drums[r] || '')) this._drum(ch, time);
	}

	// Pitched voices: a shaped oscillator (bass/arp) or detuned saw pair (lead).
	_voice(kind, note, time) {
		const ctx = this.ctx;
		const f = noteFreq(note);
		const g = ctx.createGain();
		g.connect(this.master);

		let dur, peak;
		const oscs = [];
		if (kind === 'bass') {
			dur = this.secPerRow * 1.6; peak = 0.55;
			const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = f;
			const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
			o.connect(lp); lp.connect(g); oscs.push(o);
		} else if (kind === 'arp') {
			dur = this.secPerRow * 0.9; peak = 0.18;
			const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = f;
			o.connect(g); oscs.push(o);
		} else { // lead
			dur = this.secPerRow * 3.2; peak = 0.16;
			const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600;
			lp.connect(g);
			for (const det of [-6, 6]) {
				const o = ctx.createOscillator();
				o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det;
				o.connect(lp); oscs.push(o);
			}
		}

		g.gain.setValueAtTime(0.0001, time);
		g.gain.linearRampToValueAtTime(peak, time + 0.008);
		g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
		for (const o of oscs) { o.start(time); o.stop(time + dur + 0.02); }
	}

	_drum(ch, time) {
		const ctx = this.ctx;
		if (ch === 'K') {
			const o = ctx.createOscillator();
			const g = ctx.createGain();
			o.type = 'sine';
			o.frequency.setValueAtTime(150, time);
			o.frequency.exponentialRampToValueAtTime(45, time + 0.12);
			g.gain.setValueAtTime(0.9, time);
			g.gain.exponentialRampToValueAtTime(0.0001, time + 0.18);
			o.connect(g); g.connect(this.master);
			o.start(time); o.stop(time + 0.2);
		} else if (ch === 'S') {
			const n = ctx.createBufferSource(); n.buffer = this.noise;
			const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1200;
			const g = ctx.createGain();
			g.gain.setValueAtTime(0.5, time);
			g.gain.exponentialRampToValueAtTime(0.0001, time + 0.15);
			n.connect(hp); hp.connect(g); g.connect(this.master);
			n.start(time); n.stop(time + 0.16);
		} else if (ch === 'H') {
			const n = ctx.createBufferSource(); n.buffer = this.noise;
			const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7000;
			const g = ctx.createGain();
			g.gain.setValueAtTime(0.16, time);
			g.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);
			n.connect(hp); hp.connect(g); g.connect(this.master);
			n.start(time); n.stop(time + 0.06);
		}
	}
}
