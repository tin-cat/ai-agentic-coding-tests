import * as THREE from 'three';
import { Effect } from './effect.js';
import { glyphTexture } from '../font.js';
import { FB_W, FB_H } from '../framebuffer.js';

// A small sine-scrolled caption, used as an overlay on top of another part. It
// is the same machinery as the main greeting scroller — one textured glyph quad
// per character in an orthographic 320x200 pixel space, scrolling right-to-left
// with each letter bobbing on a travelling sine — but smaller, sat lower, and
// configurable, so it can credit the (fictional) graphician under the artwork
// without disturbing the intro's scroller. Transparent background, so the part
// behind it shows through.

export class Caption extends Effect {
	constructor(text, opts = {}) {
		super();
		this.text = text;
		this.size = opts.size ?? 14;          // glyph quad size in framebuffer px
		this.spacing = opts.spacing ?? 11;    // px between character cells
		this.baseY = opts.baseY ?? 18;        // baseline height from the bottom
		this.amp = opts.amp ?? 4;             // sine bob amplitude
		this.scrollSpeed = opts.scrollSpeed ?? 55; // px/sec
		this.hue = opts.hue ?? 0.11;          // warm gold, to match the sunset
		this.fadeBeats = opts.fadeBeats ?? 4; // fade in alongside the artwork
	}

	init() {
		this.scene = new THREE.Scene();
		this.camera = new THREE.OrthographicCamera(0, FB_W, FB_H, 0, -10, 10);

		const geo = new THREE.PlaneGeometry(this.size, this.size);
		this.chars = [];
		for (let i = 0; i < this.text.length; i++) {
			const ch = this.text[i];
			if (ch === ' ') { this.chars.push(null); continue; }
			const mat = new THREE.MeshBasicMaterial({
				map: glyphTexture(ch),
				transparent: true,
				depthTest: false,
				depthWrite: false,
			});
			const m = new THREE.Mesh(geo, mat);
			m.frustumCulled = false;
			this.scene.add(m);
			this.chars.push(m);
		}
		// Loop length: whole caption plus a screen so it wraps seamlessly.
		this.period = this.text.length * this.spacing + FB_W;
	}

	update(ctx) {
		const scroll = ctx.time * this.scrollSpeed;
		const age = ctx.beat - this.startBeat;
		const fade = Math.max(0, Math.min(1, age / this.fadeBeats));

		for (let i = 0; i < this.chars.length; i++) {
			const m = this.chars[i];
			if (!m) continue;

			let x = (FB_W + i * this.spacing - scroll) % this.period;
			if (x < 0) x += this.period;
			m.position.x = x;
			m.position.y = this.baseY + this.amp * Math.sin(ctx.time * 3 + i * 0.4);

			// A gentle shared shimmer in hue rather than the intro's full rainbow,
			// so the credit reads as one calm line over the picture.
			m.material.color.setHSL((this.hue + ctx.time * 0.03) % 1, 0.85, 0.62);
			m.material.opacity = fade;
		}
	}
}
