import * as THREE from 'three';
import { Effect } from './effect.js';
import { FB_W, FB_H } from '../framebuffer.js';

// The rotozoomer: one tiled texture spread across the whole screen, spun and
// scaled in and out, the way every demo of the era showed off its blitter. The
// period-correct trick is an inverse map done per screen pixel: take the pixel's
// position relative to centre, rotate and scale it, and read the texture at the
// resulting coordinate. Because we sample with a *wrapping* coordinate
// (`fract`), the single tile repeats forever in every direction and the pattern
// stays seamless no matter how far we rotate or zoom.
//
// The tile is generated procedurally rather than loaded: a checkerboard of
// bevelled diamonds with a bright stud in each cell, coloured the demoscene way
// — the pattern yields a continuous *index* and a cosine palette maps it to a
// colour, so sliding the index (`uCycle`) is palette cycling. Rotation, zoom and
// the cycle are all locked to the beat, with a kick punching the zoom inward, so
// the whole thing breathes in time with the tune.

const ROTO_VERT = /* glsl */`
	varying vec2 vUv;
	void main() {
		vUv = uv;
		gl_Position = vec4(position.xy, 0.0, 1.0); // already in clip space
	}
`;

const ROTO_FRAG = /* glsl */`
	precision highp float;
	uniform float uAngle;    // rotation of the plane (radians), locked to the beat
	uniform float uZoom;     // texels across the screen: small = zoomed in
	uniform float uCycle;    // palette-cycle phase (locked to the beat)
	uniform vec2  uPan;       // slow drift, to show the seamless wrap
	uniform float uAspect;   // FB_W / FB_H, so the tiles stay square
	varying vec2 vUv;

	const float PI2 = 6.28318530718;

	// Cosine palette (Inigo Quilez style): a smooth saturated ramp. Shifting the
	// input phase is exactly palette cycling.
	vec3 palette(float t) {
		return 0.5 + 0.5 * cos(PI2 * (t + vec3(0.0, 0.33, 0.67)));
	}

	void main() {
		// Pixel position relative to the centre, corrected so tiles aren't squashed.
		vec2 p = vUv - 0.5;
		p.x *= uAspect;

		// Inverse rotozoom map: rotate, then scale into texture space and drift.
		float s = sin(uAngle), c = cos(uAngle);
		p = mat2(c, -s, s, c) * p;
		vec2 uv = p * uZoom + uPan;

		// One tile. fract() is the seamless wrap; g is the cell-local offset.
		vec2 g = fract(uv) - 0.5;
		float checker = mod(floor(uv.x) + floor(uv.y), 2.0); // alternating cells

		float diamond = abs(g.x) + abs(g.y);                 // 0 centre .. 1 corners
		float bevel = smoothstep(0.5, 0.40, diamond);        // raised diamond face
		float stud  = smoothstep(0.14, 0.10, length(g));     // bright centre stud

		// Continuous index: the diamond gradient, nudged per checker cell, plus the
		// cycling phase. A cosine palette turns it into rolling demo colours.
		float idx = fract(diamond * 0.5 + checker * 0.5 + uCycle);
		vec3 col = palette(idx);

		col = mix(col * 0.45, col, bevel);   // dark grout in the gaps between tiles
		col = mix(col, vec3(1.0), stud * 0.7); // metallic stud catches the light
		gl_FragColor = vec4(col, 1.0);
	}
`;

export class Rotozoom extends Effect {
	constructor() {
		super();
		this.angle = 0;
		this.pan = new THREE.Vector2(0, 0);
		this.spin = 0.7;        // base radians/sec of rotation
		this.driftSpeed = 0.12; // base texture-units/sec of pan
	}

	init() {
		this.scene = new THREE.Scene();
		this.camera = new THREE.Camera(); // shader writes clip space directly

		this.material = new THREE.ShaderMaterial({
			uniforms: {
				uAngle: { value: 0 },
				uZoom: { value: 4 },
				uCycle: { value: 0 },
				uPan: { value: this.pan },
				uAspect: { value: FB_W / FB_H },
			},
			vertexShader: ROTO_VERT,
			fragmentShader: ROTO_FRAG,
			depthTest: false,
			depthWrite: false,
		});

		const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
		mesh.frustumCulled = false;
		this.scene.add(mesh);
	}

	update(ctx) {
		// Spin and drift on the smooth real clock; the kick adds a twist of speed.
		this.angle += ctx.dt * (this.spin + 2.0 * ctx.energy);
		this.pan.x += ctx.dt * this.driftSpeed;
		this.pan.y += ctx.dt * this.driftSpeed * 0.6;

		const u = this.material.uniforms;
		u.uAngle.value = this.angle;
		// Zoom oscillates once every two bars (8 beats), locked to the tune: out to
		// ~7 tiles across, in to ~2.5, with the kick punching it further inward.
		const breathe = 0.5 - 0.5 * Math.cos(ctx.beat * (Math.PI / 4));
		u.uZoom.value = 2.5 + 4.5 * breathe - 1.2 * ctx.energy;
		// One full palette rotation per bar (4 beats), plus a shove on each kick.
		u.uCycle.value = ctx.beat * 0.25 + ctx.energy * 0.1;
	}
}
