import * as THREE from 'three';
import { Effect } from './effect.js';
import { FB_W, FB_H } from '../framebuffer.js';

// The glenz vector: a single transparent solid spinning in space, the way the
// scene showed off real 3D before textures arrived. It is the classic "glenz"
// trick — a convex polyhedron whose flat faces are drawn translucent and
// *additively*, with the depth buffer off, so wherever faces overlap their
// colours sum and the solid glows brightest through its thickest part. As it
// tumbles, the bands of overlap slide across it like light through cut glass.
//
// No lighting is needed (and none was used): the shape reads as solid purely
// from the additive build-up, each face carrying its own flat colour from the
// same cosine palette the other parts cycle. Bright additive edges trace the
// wireframe over the top, the other half of the look. Everything is then
// dithered down to 256 colours by the framebuffer, so the smooth additive
// gradients break into the period-correct banded shimmer.
//
// It rotates on all three axes at incommensurate rates (so the tumble never
// repeats), locked to the smooth clock, and the kick punches a quick scale
// pulse so the crystal "breathes" on the beat.

const PI2 = Math.PI * 2;

// Cosine palette (Inigo Quilez style), matched to the tunnel/rotozoom parts so
// the production keeps one colour identity. Returns a THREE.Color.
function paletteColor(t) {
	return new THREE.Color(
		0.5 + 0.5 * Math.cos(PI2 * (t + 0.00)),
		0.5 + 0.5 * Math.cos(PI2 * (t + 0.33)),
		0.5 + 0.5 * Math.cos(PI2 * (t + 0.67))
	);
}

export class Glenz extends Effect {
	constructor() {
		super();
		this.radius = 1.25;
	}

	init() {
		this.scene = new THREE.Scene();
		this.camera = new THREE.PerspectiveCamera(50, FB_W / FB_H, 0.1, 50);
		this.camera.position.set(0, 0, 4.6);
		this.camera.lookAt(0, 0, 0);

		// An icosahedron: 20 flat triangular faces, 30 clean edges — the iconic
		// glenz crystal. PolyhedronGeometry is non-indexed (three vertices per
		// face), so writing one colour across each face's three vertices gives a
		// genuinely flat-shaded face with no interpolation.
		const geo = new THREE.IcosahedronGeometry(this.radius, 0);
		const pos = geo.getAttribute('position');
		const faceCount = pos.count / 3;
		const colors = new Float32Array(pos.count * 3);
		for (let f = 0; f < faceCount; f++) {
			// Spread the faces evenly around the palette; the base colours sit at
			// half brightness so additive overlaps have room to bloom toward white.
			const c = paletteColor(f / faceCount).multiplyScalar(0.5);
			for (let v = 0; v < 3; v++) {
				const i = (f * 3 + v) * 3;
				colors[i] = c.r;
				colors[i + 1] = c.g;
				colors[i + 2] = c.b;
			}
		}
		geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

		// The translucent additive faces. Depth test/write off so every face is
		// drawn and contributes — front and back alike (DoubleSide) — which is
		// exactly what makes the overlaps build up.
		this.faceMat = new THREE.MeshBasicMaterial({
			vertexColors: true,
			transparent: true,
			opacity: 0.62,
			blending: THREE.AdditiveBlending,
			side: THREE.DoubleSide,
			depthTest: false,
			depthWrite: false,
		});
		this.solid = new THREE.Mesh(geo, this.faceMat);
		this.solid.frustumCulled = false;

		// Glassy edges over the top: EdgesGeometry keeps only the real polyhedron
		// edges (coplanar triangle seams are dropped), drawn bright and additive.
		const edgeMat = new THREE.LineBasicMaterial({
			color: 0x9fd0ff,
			transparent: true,
			opacity: 0.55,
			blending: THREE.AdditiveBlending,
			depthTest: false,
			depthWrite: false,
		});
		this.edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), edgeMat);
		this.edges.frustumCulled = false;

		// A pivot so the faces and edges tumble together as one object.
		this.pivot = new THREE.Group();
		this.pivot.add(this.solid);
		this.pivot.add(this.edges);
		this.scene.add(this.pivot);
	}

	update(ctx) {
		// Tumble on all three axes at unrelated rates so the motion never loops,
		// driven by the smooth real time inside ctx (ctx.time) for fluid spin.
		const t = ctx.time;
		this.pivot.rotation.x = t * 0.55;
		this.pivot.rotation.y = t * 0.37;
		this.pivot.rotation.z = t * 0.23;

		// Breathe on the kick: a quick scale-up that decays with the kick energy,
		// plus a gentle bob, both locked to the tune.
		const pulse = 1 + ctx.energy * 0.18 + 0.04 * Math.sin(ctx.beat * (Math.PI / 2));
		this.pivot.scale.setScalar(pulse);

		// Lift the edge glow on the kick so the wireframe flashes with the drums.
		this.edges.material.opacity = 0.45 + ctx.energy * 0.4;
	}
}
