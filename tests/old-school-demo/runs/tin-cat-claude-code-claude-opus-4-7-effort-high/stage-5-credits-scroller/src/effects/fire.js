import * as THREE from 'three';
import { Effect } from './effect.js';
import { FB_W, FB_H } from '../framebuffer.js';

// The classic bottom-up fire, computed on a 320x200 grid of heat values exactly
// as it was done on indexed-colour hardware. Each cell holds an intensity 0..255
// that indexes a fire palette (black -> red -> orange -> yellow -> white). Every
// frame:
//   1. The bottom row is reseeded with hot, slightly random values (the fire's
//      fuel); the kick energy stokes it so the flames surge with the drums.
//   2. Heat propagates one row upward: each cell copies the cell below it (with a
//      small random sideways "wind" offset) and cools by a random amount, so the
//      flame rises, flickers, and fades to black as it climbs.
// The grid is uploaded to a DataTexture and drawn full-screen; the engine's
// framebuffer then quantises it, so the whole thing lives inside the 320x200 /
// 256-colour budget. Heat row 0 is the bottom (DataTexture v = 0), so the seed
// line sits along the bottom of the screen with no flipping.

const W = FB_W;
const H = FB_H;

// Build the 256-entry fire palette: black -> red -> orange -> yellow -> white.
// The three channels light up in turn (red first, then green, then blue), which
// walks the ramp through orange and yellow on the way to white.
function buildPalette() {
	const lut = new Uint8Array(256 * 4);
	for (let i = 0; i < 256; i++) {
		const t = i / 255;
		const r = Math.min(1, t * 3) * 255;
		const g = Math.min(1, Math.max(0, t * 3 - 1)) * 255;
		const b = Math.min(1, Math.max(0, t * 3 - 2)) * 255;
		const o = i * 4;
		lut[o] = r; lut[o + 1] = g; lut[o + 2] = b; lut[o + 3] = 255;
	}
	return lut;
}

export class Fire extends Effect {
	constructor() {
		super();
		this.W = W;
		this.H = H;
		this.heat = new Uint8Array(W * H);   // intensity per cell, row 0 = bottom
		this.lut = buildPalette();
	}

	init() {
		this.scene = new THREE.Scene();
		// Ortho camera looking at a unit quad that fills the framebuffer.
		this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
		this.camera.position.z = 1;

		this.pixels = new Uint8Array(W * H * 4);
		this.tex = new THREE.DataTexture(this.pixels, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
		this.tex.magFilter = THREE.NearestFilter;
		this.tex.minFilter = THREE.NearestFilter;
		this.tex.generateMipmaps = false;
		// DataTexture is bottom-up (flipY false), so heat row 0 lands at the
		// bottom of the screen, where the seed line belongs.
		this.tex.needsUpdate = true;

		const mat = new THREE.MeshBasicMaterial({
			map: this.tex,
			depthTest: false,
			depthWrite: false,
		});
		const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
		mesh.frustumCulled = false;
		this.scene.add(mesh);
	}

	update(ctx) {
		const heat = this.heat;

		// 1. Seed the bottom row. Mostly hot with a little per-cell variation, the
		// odd cold gap for texture, and an overall surge driven by the kick.
		const hot = Math.min(255, 188 + Math.floor(ctx.energy * 67));
		for (let x = 0; x < W; x++) {
			heat[x] = Math.random() < 0.97
				? hot - ((Math.random() * 60) | 0)
				: 0;
		}

		// 2. Propagate upward. Row y reads from row y-1 (the hotter row below),
		// with a -1..+1 sideways wind offset, and cools by 0..2.
		for (let y = 1; y < H; y++) {
			const row = y * W;
			const below = row - W;
			for (let x = 0; x < W; x++) {
				const rnd = (Math.random() * 3) | 0;  // 0,1,2
				let sx = x + rnd - 1;                  // wind: -1,0,+1
				if (sx < 0) sx = 0; else if (sx >= W) sx = W - 1;
				const v = heat[below + sx] - rnd;      // cool as it rises
				heat[row + x] = v > 0 ? v : 0;
			}
		}

		// 3. Map heat -> fire palette into the texture buffer.
		const px = this.pixels;
		const lut = this.lut;
		for (let i = 0, n = W * H; i < n; i++) {
			const c = heat[i] << 2;
			const o = i << 2;
			px[o] = lut[c];
			px[o + 1] = lut[c + 1];
			px[o + 2] = lut[c + 2];
			px[o + 3] = 255;
		}
		this.tex.needsUpdate = true;
	}
}
