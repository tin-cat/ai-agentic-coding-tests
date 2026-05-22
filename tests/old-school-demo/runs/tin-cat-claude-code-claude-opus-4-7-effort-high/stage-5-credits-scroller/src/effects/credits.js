import * as THREE from 'three';
import { Effect } from './effect.js';
import { glyphTexture } from '../font.js';
import { FB_W, FB_H } from '../framebuffer.js';

// The obligatory end-part: a long credits roll scrolling smoothly UP the screen
// over the starfield, while the tune plays out one last time. Each line is a row
// of bitmap-font glyphs. The whole block is beat-locked - it rises at a fixed
// number of pixels per beat, derived so the entire roll clears the top in
// `scrollBeats` regardless of frame rate - so it always stays in step with the
// music. As a line travels up it (a) snakes left/right on a travelling sine wave
// (the usual scroller wobble) and (b) shrinks and dims toward the top, so the
// text appears to recede into the distance (the usual fake perspective). The
// background is transparent, so the starfield shows through behind it.
//
// The text greets and credits the (fictional) SP4CE crew in true 90s end-scroll
// style: who coded / drew / tracked it, greets to other groups, and the usual
// rambling, sleep-deprived shout-outs.

const H = (text) => ({ text, hot: true });  // section header / sign-off, runs hot
const T = (text) => ({ text, hot: false }); // body line
const B = { text: '', hot: false };          // blank spacer

const LINES = [
	H('THE 320x200 ZONE'),
	H('A SP4CE PRODUCTION'),
	B,
	H('- CODE -'),
	T('TRiXTER ...... ENGINE'),
	T('CRC^32 .. FRAMEBUFFER'),
	B,
	H('- GRAPHICS -'),
	T('AZRAEL ... EVERY PIXEL'),
	T('HAND-PLACED, NO FILTERS'),
	B,
	H('- MUSIC -'),
	T('SUBSONiC . 4 CHANNELS'),
	T('TRACKED IN ONE SITTING'),
	B,
	H('- GREETINGS -'),
	T('PARALLAX . SCANLiNE'),
	T('COPPERBARS . HEXAGON'),
	T('NOiSEFLOOR . DEADLiNE'),
	T('MEGAWATT . THE LURKERS'),
	T('NULLSET . VHS-CREW'),
	T('...AND EVERYONE STiLL'),
	T('PUSHiNG PiXELS IN 1996'),
	B,
	H('- THE RAMBLING PART -'),
	T('STiLL READiNG? RESPECT.'),
	T('CODED AT 4AM ON STALE'),
	T('PIZZA THE NIGHT BEFORE'),
	T('THE COMPO DEADLiNE.'),
	T('GREETS TO MUM FOR THE'),
	T('ENDLESS POTS OF COFFEE.'),
	T('IF IT FLiCKERS, THAT IS'),
	T('A FEATURE, NOT A BUG ;)'),
	T('REAL SCENERS COUNT IN HEX'),
	T('SEE YOU AT THE NEXT PARTY'),
	B,
	H('SP4CE - SiNCE FOREVER'),
	B,
	H('WRAP!'),
	B,
];

function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }

// Hermite smoothstep, edges e0 -> e1.
function smoothstep(e0, e1, x) {
	const t = clamp((x - e0) / (e1 - e0), 0, 1);
	return t * t * (3 - 2 * t);
}

export class Credits extends Effect {
	constructor(opts = {}) {
		super();
		this.size = opts.size ?? 13;            // glyph quad size (px) at full scale
		this.spacing = opts.spacing ?? 10;      // px between character cells, full scale
		this.lineHeight = opts.lineHeight ?? 22; // px between baselines, full scale
		this.scrollBeats = opts.scrollBeats ?? 52; // beats for the whole roll to clear
		this.amp = opts.amp ?? 9;               // sine snake amplitude (px)
		this.fadeBeats = opts.fadeBeats ?? 3;   // roll eases in over its first beats
	}

	init() {
		this.scene = new THREE.Scene();
		// left, right, top, bottom -> pixel space with y up, matching the scroller.
		this.camera = new THREE.OrthographicCamera(0, FB_W, FB_H, 0, -10, 10);

		// A unit quad scaled per character to the desired pixel size each frame, so
		// the perspective shrink is a single scale write.
		const geo = new THREE.PlaneGeometry(1, 1);

		this.lines = [];
		for (let li = 0; li < LINES.length; li++) {
			const { text, hot } = LINES[li];
			const meshes = [];
			for (let j = 0; j < text.length; j++) {
				const ch = text[j];
				if (ch === ' ') { meshes.push(null); continue; }
				const mat = new THREE.MeshBasicMaterial({
					map: glyphTexture(ch),
					transparent: true,
					depthTest: false,
					depthWrite: false,
				});
				const m = new THREE.Mesh(geo, mat);
				m.frustumCulled = false;
				this.scene.add(m);
				meshes.push(m);
			}
			this.lines.push({ hot, n: text.length, meshes });
		}

		// Pixels per beat so the whole block (plus a screen of run-up) clears the
		// top exactly at `scrollBeats`.
		const blockH = LINES.length * this.lineHeight;
		this.pxPerBeat = (FB_H + blockH) / this.scrollBeats;
	}

	update(ctx) {
		const age = ctx.beat - this.startBeat;
		const fadeIn = clamp(age / this.fadeBeats, 0, 1);
		const scroll = Math.max(0, age) * this.pxPerBeat;

		for (let li = 0; li < this.lines.length; li++) {
			const line = this.lines[li];

			// Line 0 starts one line-height below the bottom edge and rises.
			const y = scroll - (li + 1) * this.lineHeight;

			// Perspective: shrink toward the top so the roll recedes into distance.
			const yN = clamp(y / FB_H, 0, 1);
			const scale = 1.0 - 0.5 * yN;

			// The usual scroller wobble: the column snakes on a travelling sine,
			// keyed off screen height so the whole roll reads as one waving ribbon.
			const wob = this.amp * Math.sin(y * 0.018 + ctx.time * 1.4);

			// Fade a line in as it rises into view, out as it recedes near the top;
			// the whole part also eases in over its first beats.
			const aIn = smoothstep(-this.lineHeight, 18, y);
			const aOut = 1 - smoothstep(FB_H - 50, FB_H - 8, y);
			const alpha = fadeIn * aIn * aOut;

			// Headers / sign-offs run hot and pulse; body lines drift through a calm
			// hue cycle so the roll shimmers without becoming hard to read.
			let h, s, l;
			if (line.hot) {
				h = (0.05 + ctx.time * 0.06) % 1;
				s = 0.85;
				l = 0.66 + 0.12 * Math.sin(ctx.time * 5 + li);
			} else {
				h = (0.08 + li * 0.015 + ctx.time * 0.04) % 1;
				s = 0.5;
				l = 0.62;
			}

			const eSpacing = this.spacing * scale;
			const xStart = FB_W / 2 - ((line.n - 1) * eSpacing) / 2 + wob;
			const sz = this.size * scale;

			for (let j = 0; j < line.meshes.length; j++) {
				const m = line.meshes[j];
				if (!m) continue;
				m.visible = alpha > 0.002;
				if (!m.visible) continue;
				m.position.x = xStart + j * eSpacing;
				m.position.y = y;
				m.scale.setScalar(sz);
				m.material.color.setHSL(h, s, l);
				m.material.opacity = alpha;
			}
		}
	}
}
