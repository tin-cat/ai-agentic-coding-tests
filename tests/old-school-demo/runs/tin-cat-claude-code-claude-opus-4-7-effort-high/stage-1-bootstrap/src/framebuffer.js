import * as THREE from 'three';

// The heart of the engine: a fixed 320x200 internal framebuffer, a palette
// quantisation pass that reduces every frame to <=256 colours, and a chunky
// nearest-neighbour upscale to fill the window at a correct 4:3 aspect ratio.
//
// Pipeline, every frame:
//   1. SCENE  -> rtScene    : effects draw into a 320x200 RGBA target.
//   2. QUANT  -> rtIndexed  : ordered-dither + reduce to the 3-3-2 palette.
//   3. UPSCALE-> screen     : draw rtIndexed nearest-filtered into a 4:3 box.
//
// The "256 colours" constraint is realised as a fixed 3-3-2-bit palette
// (8 reds x 8 greens x 4 blues = 256). It is a structured palette, so it can be
// applied per-pixel in a shader without a 256-entry nearest-colour search. A
// 4x4 Bayer matrix dithers before quantising, which is what gives the era's
// characteristic shimmer in gradients. See README for swapping in a custom LUT.

export const FB_W = 320;
export const FB_H = 200;
const ASPECT = 4 / 3; // displayed aspect (pixels were tall on a CRT)

const QUANT_FRAG = /* glsl */`
	uniform sampler2D tDiffuse;
	uniform vec2 uFbSize;
	uniform float uFlash;     // additive white flash for beat transitions
	varying vec2 vUv;

	// 4x4 ordered (Bayer) dither value at pixel p, in 0..15. Computed
	// arithmetically (no array constructors / dynamic indexing) so it stays
	// valid GLSL ES 1.00, which is what THREE.ShaderMaterial emits.
	// Built from the 2x2 base matrix [[0,2],[3,1]]: bayer4 = 4*hi + lo.
	float b2(float a, float c) {
		if (a == c) return a;          // (0,0)->0, (1,1)->1
		return (a < c) ? 3.0 : 2.0;    // (0,1)->3, (1,0)->2
	}
	float bayer4(vec2 p) {
		float X = mod(p.x, 4.0);
		float Y = mod(p.y, 4.0);
		float hi = b2(floor(X * 0.5), floor(Y * 0.5));
		float lo = b2(mod(X, 2.0), mod(Y, 2.0));
		return hi * 4.0 + lo;
	}

	void main() {
		vec3 c = texture2D(tDiffuse, vUv).rgb + uFlash;

		// Per-framebuffer-pixel dither threshold in [-0.5, 0.5).
		vec2 p = floor(vUv * uFbSize);
		float t = (bayer4(p) + 0.5) / 16.0 - 0.5;

		// 3-3-2 palette: 8 levels of R, 8 of G, 4 of B.
		vec3 levels = vec3(8.0, 8.0, 4.0);
		c += t / (levels - 1.0);             // spread dither across one step
		c = clamp(c, 0.0, 1.0);
		c = floor(c * (levels - 1.0) + 0.5) / (levels - 1.0);

		gl_FragColor = vec4(c, 1.0);
	}
`;

const UPSCALE_FRAG = /* glsl */`
	uniform sampler2D tDiffuse;
	varying vec2 vUv;
	void main() {
		// rtIndexed is NearestFilter, so this is a hard chunky-pixel blit.
		gl_FragColor = texture2D(tDiffuse, vUv);
	}
`;

const FULLSCREEN_VERT = /* glsl */`
	varying vec2 vUv;
	void main() {
		vUv = uv;
		gl_Position = vec4(position.xy, 0.0, 1.0); // already in clip space
	}
`;

export class Framebuffer {
	constructor(renderer) {
		this.renderer = renderer;

		const rtOpts = {
			minFilter: THREE.NearestFilter,
			magFilter: THREE.NearestFilter,
			format: THREE.RGBAFormat,
			depthBuffer: true,
			stencilBuffer: false,
		};
		this.rtScene = new THREE.WebGLRenderTarget(FB_W, FB_H, rtOpts);
		this.rtIndexed = new THREE.WebGLRenderTarget(FB_W, FB_H, rtOpts);

		// A camera is required by renderer.render(); our shaders write
		// gl_Position directly, so its matrices are never used.
		this.quadCam = new THREE.Camera();
		const quad = () => new THREE.PlaneGeometry(2, 2);

		this.quantMat = new THREE.ShaderMaterial({
			uniforms: {
				tDiffuse: { value: this.rtScene.texture },
				uFbSize: { value: new THREE.Vector2(FB_W, FB_H) },
				uFlash: { value: 0 },
			},
			vertexShader: FULLSCREEN_VERT,
			fragmentShader: QUANT_FRAG,
			depthTest: false,
			depthWrite: false,
		});
		this.quantScene = new THREE.Scene();
		const quantMesh = new THREE.Mesh(quad(), this.quantMat);
		quantMesh.frustumCulled = false;
		this.quantScene.add(quantMesh);

		this.upMat = new THREE.ShaderMaterial({
			uniforms: { tDiffuse: { value: this.rtIndexed.texture } },
			vertexShader: FULLSCREEN_VERT,
			fragmentShader: UPSCALE_FRAG,
			depthTest: false,
			depthWrite: false,
		});
		this.upScene = new THREE.Scene();
		const upMesh = new THREE.Mesh(quad(), this.upMat);
		upMesh.frustumCulled = false;
		this.upScene.add(upMesh);

		this.outW = this.outH = 0;
		this.vx = this.vy = this.vw = this.vh = 0;
	}

	// Compute the centred, letterboxed 4:3 viewport inside the window.
	setOutputSize(w, h) {
		this.outW = w;
		this.outH = h;
		let vw = w;
		let vh = Math.round(w / ASPECT);
		if (vh > h) {
			vh = h;
			vw = Math.round(h * ASPECT);
		}
		this.vw = vw;
		this.vh = vh;
		this.vx = Math.floor((w - vw) / 2);
		this.vy = Math.floor((h - vh) / 2);
	}

	// `effects` render in order into the shared 320x200 target. The first
	// effect paints over a cleared black frame; later effects keep the colour
	// (transparent backgrounds) but get a fresh depth buffer so paint order
	// decides layering (e.g. the scroller draws over the starfield).
	render(effects, ctx) {
		const r = this.renderer;

		r.setRenderTarget(this.rtScene);
		r.autoClear = false;
		r.setViewport(0, 0, FB_W, FB_H);
		r.clear(true, true, true);
		for (let i = 0; i < effects.length; i++) {
			if (i > 0) r.clearDepth();
			effects[i].render(r);
		}

		// Pass 2: quantise to the palette.
		this.quantMat.uniforms.uFlash.value = ctx.flash || 0;
		r.autoClear = true;
		r.setRenderTarget(this.rtIndexed);
		r.setViewport(0, 0, FB_W, FB_H);
		r.render(this.quantScene, this.quadCam);

		// Pass 3: upscale into the 4:3 viewport, black bars around it.
		r.setRenderTarget(null);
		r.setViewport(0, 0, this.outW, this.outH);
		r.clear(true, true, true);
		r.setViewport(this.vx, this.vy, this.vw, this.vh);
		r.render(this.upScene, this.quadCam);
		r.setViewport(0, 0, this.outW, this.outH);
	}
}
