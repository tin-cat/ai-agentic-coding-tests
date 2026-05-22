import * as THREE from 'three';
import { Effect } from './effect.js';
import { FB_W, FB_H } from '../framebuffer.js';

// The classic textured tunnel: an endless cylinder the camera flies down. The
// trick is the per-pixel mapping, exactly as it was done in the 90s with a
// precomputed table — for each screen pixel we take its angle around the centre
// and its "depth" (1 / radius). Angle maps to the texture's u, depth to v; as we
// advance v the wall texture rushes toward us, and adding a depth-dependent twist
// to the angle makes the tunnel writhe. A radial shade darkens the far end
// (centre) for the depth cue.
//
// Colour is done the period-correct way: the texture produces a single *index*
// (0..1), and a palette function maps that index to a colour. Cycling the index
// (`uCycle`) is palette cycling — the wall texture stays put while its colours
// rotate. We lock `uCycle` to the beat so the colours roll exactly in time with
// the music, with an extra shove on each kick.

const TUNNEL_VERT = /* glsl */`
	varying vec2 vUv;
	void main() {
		vUv = uv;
		gl_Position = vec4(position.xy, 0.0, 1.0); // already in clip space
	}
`;

const TUNNEL_FRAG = /* glsl */`
	precision highp float;
	uniform float uScroll;   // distance flown down the tunnel
	uniform float uCycle;    // palette-cycle phase (locked to the beat)
	uniform float uTwist;    // how hard the tunnel writhes
	uniform float uTime;
	uniform float uAspect;   // FB_W / FB_H, so the bore stays round-ish
	varying vec2 vUv;

	const float PI2 = 6.28318530718;

	// Cosine palette (Inigo Quilez style): a smooth, saturated rainbow ramp.
	// Shifting the input phase is precisely palette cycling.
	vec3 palette(float t) {
		return 0.5 + 0.5 * cos(PI2 * (t + vec3(0.0, 0.33, 0.67)));
	}

	void main() {
		vec2 p = vUv - 0.5;
		p.x *= uAspect;
		float r = length(p);
		float a = atan(p.y, p.x);              // -PI..PI

		float depth = 0.32 / max(r, 0.0008);   // 1/r: far at centre, near at edge

		// Twist: rotate the angle by an amount that grows with depth and breathes
		// over time, so the bore appears to corkscrew as we fly.
		a += uTwist * sin(depth * 0.6 + uTime * 0.7);

		// Texture coordinates on the tunnel wall.
		float u = a / PI2;                     // around the bore
		float v = depth + uScroll;             // along it (this is the fly-through)

		// Wall texture -> a continuous 0..1 index. Rings rushing toward us, broken
		// up by lengthwise spokes, give it structure without losing smooth bands
		// for the palette to cycle through.
		float rings  = sin(v * 6.0);
		float spokes = sin(u * PI2 * 8.0);
		float idx = fract((rings * 0.5 + 0.5) * 0.65 + (spokes * 0.5 + 0.5) * 0.35 + uCycle);

		vec3 col = palette(idx);

		// Depth shade: darken toward the centre (the far end) and lift the rim.
		float shade = clamp(r * 2.3, 0.05, 1.0);
		col *= shade;

		gl_FragColor = vec4(col, 1.0);
	}
`;

export class Tunnel extends Effect {
	constructor() {
		super();
		this.scroll = 0;
		this.baseSpeed = 0.55;  // tunnel units per second
		this.kickSpeed = 1.6;   // extra fly speed scaled by kick energy
	}

	init() {
		this.scene = new THREE.Scene();
		this.camera = new THREE.Camera(); // shader writes clip space directly

		this.material = new THREE.ShaderMaterial({
			uniforms: {
				uScroll: { value: 0 },
				uCycle: { value: 0 },
				uTwist: { value: 0 },
				uTime: { value: 0 },
				uAspect: { value: FB_W / FB_H },
			},
			vertexShader: TUNNEL_VERT,
			fragmentShader: TUNNEL_FRAG,
			depthTest: false,
			depthWrite: false,
		});

		const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
		mesh.frustumCulled = false;
		this.scene.add(mesh);
	}

	update(ctx) {
		// Fly forward on the smooth real clock; kicks accelerate the descent.
		this.scroll += ctx.dt * (this.baseSpeed + this.kickSpeed * ctx.energy);

		const u = this.material.uniforms;
		u.uScroll.value = this.scroll;
		u.uTime.value = ctx.time;
		// One full palette rotation per bar (4 beats), locked to the tune, plus a
		// shove on each kick so the colours pulse with the drums.
		u.uCycle.value = ctx.beat * 0.25 + ctx.energy * 0.12;
		// Twist breathes once per bar and tightens on the kick.
		u.uTwist.value = 0.45 * Math.sin(ctx.beat * 0.5) + ctx.energy * 0.35;
	}
}
