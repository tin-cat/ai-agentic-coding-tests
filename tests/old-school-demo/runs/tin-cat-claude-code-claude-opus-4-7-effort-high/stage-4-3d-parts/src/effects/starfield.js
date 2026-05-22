import * as THREE from 'three';
import { Effect } from './effect.js';
import { FB_W, FB_H } from '../framebuffer.js';

// Classic 3D starfield flying toward the viewer. Points stream in from far away
// (negative z) toward the camera at the origin; when one passes the camera it
// recycles to the back with a fresh x/y. A custom point shader sizes and
// brightens each star by proximity, so near stars are big bright squares and
// distant ones are dim single pixels. Forward speed pulses with the kick.

const STAR_VERT = /* glsl */`
	uniform float uSize;
	uniform float uFar;
	varying float vB;
	void main() {
		vec4 mv = modelViewMatrix * vec4(position, 1.0);
		gl_Position = projectionMatrix * mv;
		float dist = max(-mv.z, 0.001);
		gl_PointSize = clamp(uSize / dist, 1.0, 9.0);
		vB = clamp(1.0 - dist / uFar, 0.0, 1.0); // proximity 0..1
	}
`;

const STAR_FRAG = /* glsl */`
	varying float vB;
	void main() {
		// Square points (we never discard gl_PointCoord) -> chunky stars.
		vec3 base = vec3(0.62, 0.72, 1.0);
		float b = 0.12 + 0.88 * vB * vB;
		gl_FragColor = vec4(base * b, 1.0);
	}
`;

export class Starfield extends Effect {
	constructor() {
		super();
		this.count = 600;
		this.far = 80;
		this.spreadX = this.far * 0.95;
		this.spreadY = this.far * 0.72;
		this.baseSpeed = 26;
	}

	init() {
		this.scene = new THREE.Scene();
		this.camera = new THREE.PerspectiveCamera(75, FB_W / FB_H, 0.1, this.far + 10);
		this.camera.position.set(0, 0, 0);

		this.pos = new Float32Array(this.count * 3);
		for (let i = 0; i < this.count; i++) this._respawn(i, true);

		const geo = new THREE.BufferGeometry();
		geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));

		this.material = new THREE.ShaderMaterial({
			uniforms: {
				uSize: { value: 95 },
				uFar: { value: this.far },
			},
			vertexShader: STAR_VERT,
			fragmentShader: STAR_FRAG,
			depthTest: true,
			depthWrite: true,
		});

		this.points = new THREE.Points(geo, this.material);
		this.points.frustumCulled = false;
		this.scene.add(this.points);
	}

	// Place star i. If `anywhere`, distribute along z too (initial fill);
	// otherwise drop it at the far plane (recycling).
	_respawn(i, anywhere) {
		const a = this.pos;
		a[i * 3] = (Math.random() * 2 - 1) * this.spreadX;
		a[i * 3 + 1] = (Math.random() * 2 - 1) * this.spreadY;
		a[i * 3 + 2] = anywhere ? -Math.random() * this.far : -this.far;
	}

	update(ctx) {
		const speed = this.baseSpeed * (1 + ctx.energy * 2.2);
		const dz = speed * ctx.dt;
		const a = this.pos;
		for (let i = 0; i < this.count; i++) {
			a[i * 3 + 2] += dz; // toward camera at z = 0
			if (a[i * 3 + 2] > -0.4) this._respawn(i, false);
		}
		this.points.geometry.attributes.position.needsUpdate = true;
	}
}
