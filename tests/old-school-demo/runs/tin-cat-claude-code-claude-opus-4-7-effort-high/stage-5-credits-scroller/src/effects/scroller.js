import * as THREE from 'three';
import { Effect } from './effect.js';
import { glyphTexture } from '../font.js';
import { FB_W, FB_H } from '../framebuffer.js';

// The obligatory greeting line: a single row of large bitmap-font text scrolling
// right-to-left along the bottom, every character bobbing on a travelling sine
// wave. Colour cycles through a rainbow per character (copper-bar text), the
// whole line fades in over its first beats, and characters bounce a touch on
// each kick. Renders in an orthographic 320x200 pixel space with a transparent
// background so the starfield shows through behind it.

const MESSAGE =
	'GREETINGS FROM THE 320x200 ZONE !!!   ' +
	'A CHUNKY-PIXEL DEMO RENDERED INTO A 256-COLOUR FRAMEBUFFER, ' +
	'JUST LIKE THE GOOD OLD DAYS.   ' +
	'CODE + THREE.JS + WEB AUDIO ... NO SAMPLES, NO INTERACTION, PURE VIBES.   ' +
	'SHOUTS TO EVERYONE STILL PUSHING PIXELS.   WRAP !   ';

export class Scroller extends Effect {
	constructor() {
		super();
		this.spacing = 19;   // px between character cells
		this.size = 26;      // glyph quad size in framebuffer px
		this.baseY = 32;     // baseline height from the bottom
		this.amp = 14;       // sine bob amplitude
		this.scrollSpeed = 82; // px/sec
	}

	init() {
		this.scene = new THREE.Scene();
		// left, right, top, bottom -> pixel space with y up.
		this.camera = new THREE.OrthographicCamera(0, FB_W, FB_H, 0, -10, 10);

		const geo = new THREE.PlaneGeometry(this.size, this.size);
		this.chars = [];
		for (let i = 0; i < MESSAGE.length; i++) {
			const ch = MESSAGE[i];
			if (ch === ' ') { this.chars.push(null); continue; }
			const mat = new THREE.MeshBasicMaterial({
				map: glyphTexture(ch),
				transparent: true,
				depthTest: false,
				depthWrite: false,
			});
			const m = new THREE.Mesh(geo, mat);
			m.frustumCulled = false;
			m.position.z = 0;
			this.scene.add(m);
			this.chars.push(m);
		}
		// Loop length: whole message plus a screen so it wraps seamlessly.
		this.period = MESSAGE.length * this.spacing + FB_W;
	}

	update(ctx) {
		const scroll = ctx.time * this.scrollSpeed;
		const age = ctx.beat - this.startBeat;
		const fade = Math.max(0, Math.min(1, age / 2)); // fade in over 2 beats
		const bounce = 1 + 0.18 * ctx.energy;

		for (let i = 0; i < this.chars.length; i++) {
			const m = this.chars[i];
			if (!m) continue;

			// Infinite right-to-left wrap via modulo over the loop length.
			let x = (FB_W + i * this.spacing - scroll) % this.period;
			if (x < 0) x += this.period;
			m.position.x = x;
			m.position.y = this.baseY + this.amp * Math.sin(ctx.time * 4 + i * 0.45);
			m.scale.setScalar(bounce);

			const hue = (ctx.time * 0.12 + i * 0.025) % 1;
			m.material.color.setHSL(hue, 1.0, 0.6);
			m.material.opacity = fade;
		}
	}
}
