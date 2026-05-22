import * as THREE from 'three';
import { Effect } from './effect.js';
import { FB_W, FB_H } from '../framebuffer.js';

// The graphician's showcase: the part whose only job is to show off a gorgeous
// hand-crafted picture, exactly as 90s demos paused to do. The artwork is a
// painted sunset over a mirror sea — a deliberately classic pixel-graphician
// subject — drawn once into a 320x200 canvas so every "pixel" is placed by hand
// (well, by code) and then handed to the engine, which dithers it down into the
// 256-colour palette for the authentic banded look.
//
// Two period touches sit on top in a shader: a slow fade-in *reveal* that brings
// the image up out of black over a few beats, and a **palette-cycled** glitter on
// the water — a travelling bright band rolling up the reflection, the trick every
// demo used to make still water shimmer without redrawing it. A separate caption
// effect (added alongside this one in main.js) sine-scrolls the artist credit.

// Paint the picture into a 320x200 canvas. Smooth canvas gradients are fine: the
// framebuffer's ordered dither turns them into the era's characteristic bands.
function paintArtwork() {
	const c = document.createElement('canvas');
	c.width = FB_W;
	c.height = FB_H;
	const g = c.getContext('2d');
	g.imageSmoothingEnabled = false;

	const HORIZON = 120; // y of the waterline

	// --- Sky: deep dusk at the top falling to a hot glow at the horizon. ---
	const sky = g.createLinearGradient(0, 0, 0, HORIZON);
	sky.addColorStop(0.0, '#241046');
	sky.addColorStop(0.35, '#5a2363');
	sky.addColorStop(0.65, '#b23b56');
	sky.addColorStop(0.85, '#ec7a3a');
	sky.addColorStop(1.0, '#ffd27a');
	g.fillStyle = sky;
	g.fillRect(0, 0, FB_W, HORIZON);

	// --- Stars, thicker toward the dark top of the sky. ---
	let seed = 1234;
	const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
	for (let i = 0; i < 110; i++) {
		const x = Math.floor(rnd() * FB_W);
		const y = Math.floor(rnd() * (HORIZON - 30));
		// Fewer, dimmer stars as we near the bright horizon.
		if (rnd() < y / (HORIZON - 30)) continue;
		const b = 150 + Math.floor(rnd() * 105);
		g.fillStyle = `rgb(${b},${b},${Math.min(255, b + 30)})`;
		g.fillRect(x, y, 1, 1);
	}

	// --- The sun, sitting on the horizon: a hot core fading to the sky glow. ---
	const sunX = 196;
	const sunR = 30;
	const sun = g.createRadialGradient(sunX, HORIZON, 2, sunX, HORIZON, sunR);
	sun.addColorStop(0.0, '#fff6d8');
	sun.addColorStop(0.45, '#ffe487');
	sun.addColorStop(0.8, '#ff9a3c');
	sun.addColorStop(1.0, 'rgba(255,120,50,0)');
	g.fillStyle = sun;
	g.beginPath();
	g.arc(sunX, HORIZON, sunR, 0, Math.PI * 2);
	g.fill();

	// --- Mountain ranges: a pale far ridge, then a darker near one. ---
	const ridge = (baseY, amp, step, fill, jag) => {
		g.fillStyle = fill;
		g.beginPath();
		g.moveTo(0, HORIZON);
		let y = baseY;
		for (let x = 0; x <= FB_W; x += step) {
			y += (rnd() - 0.5) * jag;
			y = Math.max(baseY - amp, Math.min(baseY + amp, y));
			g.lineTo(x, y);
		}
		g.lineTo(FB_W, HORIZON);
		g.closePath();
		g.fill();
	};
	ridge(96, 14, 10, '#6b3a6e', 9);  // far range, lit by the dusk
	ridge(110, 12, 8, '#3a1f44', 11); // near range, in shadow

	// --- Sea: a mirror of the sky, darkening with depth toward the viewer. ---
	const sea = g.createLinearGradient(0, HORIZON, 0, FB_H);
	sea.addColorStop(0.0, '#e9a657');
	sea.addColorStop(0.18, '#a64f63');
	sea.addColorStop(0.5, '#4a2356');
	sea.addColorStop(1.0, '#160a2c');
	g.fillStyle = sea;
	g.fillRect(0, HORIZON, FB_W, FB_H - HORIZON);

	// The sun's reflection: a broken column of bright dashes that widens and
	// breaks up as it nears the viewer — the classic painted water glitter.
	for (let y = HORIZON; y < FB_H; y++) {
		const t = (y - HORIZON) / (FB_H - HORIZON);
		const w = 3 + t * 26;                 // reflection spreads toward us
		const a = (1 - t) * 0.9;              // and fades with depth
		const wobble = Math.sin(y * 0.8) * t * 6;
		const cx = sunX + wobble;
		// Break the column into dashes so it reads as moving water, not a bar.
		if ((y * 1.7 + Math.floor(rnd() * 3)) % 3 === 0) continue;
		const r = Math.floor(255);
		const gr = Math.floor(210 - t * 90);
		const bl = Math.floor(120 - t * 80);
		g.fillStyle = `rgba(${r},${gr},${Math.max(0, bl)},${a})`;
		g.fillRect(Math.round(cx - w / 2), y, Math.round(w), 1);
	}

	// A lone sail on the sea, far off, for a focal point.
	g.fillStyle = '#1a0e30';
	g.beginPath();
	g.moveTo(96, 132);
	g.lineTo(96, 122);
	g.lineTo(104, 132);
	g.closePath();
	g.fill();
	g.fillRect(95, 132, 10, 2);

	const tex = new THREE.CanvasTexture(c);
	tex.magFilter = THREE.NearestFilter;
	tex.minFilter = THREE.NearestFilter;
	tex.generateMipmaps = false;
	tex.needsUpdate = true;
	// CanvasTexture flips Y, so canvas-top (the sky) lands at v = 1 (screen top).
	// The waterline at canvas y = HORIZON is therefore at v = 1 - HORIZON/FB_H.
	return { tex, horizonV: 1 - HORIZON / FB_H };
}

const ART_VERT = /* glsl */`
	varying vec2 vUv;
	void main() {
		vUv = uv;
		gl_Position = vec4(position.xy, 0.0, 1.0); // already in clip space
	}
`;

const ART_FRAG = /* glsl */`
	precision highp float;
	uniform sampler2D tImg;
	uniform float uReveal;   // 0 = black, 1 = fully shown (slow fade-in reveal)
	uniform float uTime;
	uniform float uHorizon;  // v of the waterline; below it is sea
	varying vec2 vUv;

	void main() {
		vec3 col = texture2D(tImg, vUv).rgb;

		// Palette-cycled water glitter: a bright band travels up the reflection,
		// brightest near the surface, so the still sea appears to shimmer. This is
		// the same effect a real palette cycle gives, done per pixel here.
		if (vUv.y < uHorizon) {
			float depth = (uHorizon - vUv.y) / uHorizon;          // 0 surface .. 1 near
			float band = sin(vUv.y * 90.0 - uTime * 3.0);
			float glint = smoothstep(0.7, 1.0, band) * (1.0 - depth);
			col += glint * vec3(0.30, 0.20, 0.06);
		}

		// Slow reveal up out of black; runs *before* quantise so it fades through
		// the palette like a real demo.
		col *= uReveal;
		gl_FragColor = vec4(col, 1.0);
	}
`;

export class Artwork extends Effect {
	constructor() {
		super();
		this.revealBeats = 4; // fade the picture in over its first bar
	}

	init() {
		this.scene = new THREE.Scene();
		this.camera = new THREE.Camera(); // shader writes clip space directly

		const { tex, horizonV } = paintArtwork();
		this.material = new THREE.ShaderMaterial({
			uniforms: {
				tImg: { value: tex },
				uReveal: { value: 0 },
				uTime: { value: 0 },
				uHorizon: { value: horizonV },
			},
			vertexShader: ART_VERT,
			fragmentShader: ART_FRAG,
			depthTest: false,
			depthWrite: false,
		});

		const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
		mesh.frustumCulled = false;
		this.scene.add(mesh);
	}

	update(ctx) {
		const age = ctx.beat - this.startBeat;
		const u = this.material.uniforms;
		u.uReveal.value = Math.max(0, Math.min(1, age / this.revealBeats));
		u.uTime.value = ctx.time;
	}
}
