import * as THREE from 'three';
import { Effect } from './effect.js';
import { FB_W, FB_H } from '../framebuffer.js';

// The 3D fly-by: the "look what this machine can do" part. A camera races down
// an endless corridor of polished chrome monoliths over a wet, grid-lit floor,
// under a low sun — real Three.js PBR with real-time shadow maps, environment
// reflections (image-based lighting from a generated sky), textured surfaces and
// a fake lens flare floating in front of the lens. Everything modern rendering
// can do.
//
// And then it all goes through the same 320x200 / 256-colour sieve as every
// other part: the framebuffer renders this scene into the tiny target and the
// quantiser dithers it down, so the gorgeous reflections and soft shadows come
// out chunky and banded — period-correct, like a 90s scener who somehow had a
// GPU. The point isn't the fidelity Three.js can reach; it's how good it looks
// after being crushed back into the palette.
//
// The corridor is endless by recycling: the camera sits at the origin looking
// down -z while the monoliths stream toward it and wrap to the back when they
// pass, so the part can run (and loop) forever with no seams of its own. Speed
// surges on the kick, the coloured key lights cycle and pulse with the tune, and
// the camera sways gently on the beat.

const PI2 = Math.PI * 2;
const EYE = 1.7;          // camera height above the floor
const LANE = 3.4;         // half-width of the corridor (monoliths sit at ±LANE)
const STEP = 6.0;         // spacing between monolith pairs along the corridor
const PER_SIDE = 26;      // monoliths per side; span = PER_SIDE * STEP
const SPAN = PER_SIDE * STEP;
const RECYCLE_Z = 7.0;    // once a monolith passes this z it wraps to the back

function paletteColor(t) {
	return new THREE.Color(
		0.5 + 0.5 * Math.cos(PI2 * (t + 0.00)),
		0.5 + 0.5 * Math.cos(PI2 * (t + 0.33)),
		0.5 + 0.5 * Math.cos(PI2 * (t + 0.67))
	);
}

// Equirectangular sky: a dusk gradient with a hot sun low on the horizon. Fed to
// a PMREM pass for image-based reflections, and used directly as the skybox.
function makeSkyTexture() {
	const c = document.createElement('canvas');
	c.width = 512;
	c.height = 256;
	const g = c.getContext('2d');
	const sky = g.createLinearGradient(0, 0, 0, 256);
	sky.addColorStop(0.0, '#101a3a'); // zenith
	sky.addColorStop(0.45, '#3b2b6b');
	sky.addColorStop(0.62, '#9c3d6e');
	sky.addColorStop(0.74, '#ec7a3a'); // horizon glow
	sky.addColorStop(0.78, '#1a1426'); // ground line
	sky.addColorStop(1.0, '#05040a'); // ground
	g.fillStyle = sky;
	g.fillRect(0, 0, 512, 256);

	// The sun, sitting just above the horizon a little off-centre.
	const sun = g.createRadialGradient(150, 184, 2, 150, 184, 46);
	sun.addColorStop(0.0, '#fff4d4');
	sun.addColorStop(0.4, '#ffd070');
	sun.addColorStop(1.0, 'rgba(255,150,60,0)');
	g.fillStyle = sun;
	g.fillRect(0, 110, 300, 140);

	const tex = new THREE.CanvasTexture(c);
	tex.mapping = THREE.EquirectangularReflectionMapping;
	return tex;
}

// The floor: a dark panel with glowing teal grid lines, tiled and wrap-scrolled
// so the ground appears to rush past as we fly.
function makeFloorTexture() {
	const N = 128;
	const c = document.createElement('canvas');
	c.width = c.height = N;
	const g = c.getContext('2d');
	g.fillStyle = '#0a0c14';
	g.fillRect(0, 0, N, N);
	g.strokeStyle = '#2fd8d0';
	g.lineWidth = 3;
	g.strokeRect(0, 0, N, N);
	// A fainter inner cross so each tile reads as a panel of four.
	g.strokeStyle = '#15524f';
	g.lineWidth = 1;
	g.beginPath();
	g.moveTo(N / 2, 0); g.lineTo(N / 2, N);
	g.moveTo(0, N / 2); g.lineTo(N, N / 2);
	g.stroke();

	const tex = new THREE.CanvasTexture(c);
	tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
	tex.repeat.set(60, 60);
	tex.magFilter = THREE.NearestFilter;
	return tex;
}

// A panelled greeble texture for the monolith faces, so the chrome isn't a blank
// mirror — rows of recessed windows that catch the moving lights.
function makePanelTexture() {
	const c = document.createElement('canvas');
	c.width = 64;
	c.height = 128;
	const g = c.getContext('2d');
	g.fillStyle = '#1b2030';
	g.fillRect(0, 0, 64, 128);
	g.fillStyle = '#aab4d0';
	for (let y = 6; y < 128; y += 12) {
		for (let x = 8; x < 64; x += 18) {
			g.fillRect(x, y, 10, 7);
		}
	}
	const tex = new THREE.CanvasTexture(c);
	tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
	return tex;
}

// Soft radial dot, white core fading to nothing — the building block for the
// fake lens flare ghosts and the sun glow.
function makeGlowTexture() {
	const N = 128;
	const c = document.createElement('canvas');
	c.width = c.height = N;
	const g = c.getContext('2d');
	const grd = g.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2);
	grd.addColorStop(0.0, 'rgba(255,255,255,1)');
	grd.addColorStop(0.25, 'rgba(255,240,210,0.7)');
	grd.addColorStop(1.0, 'rgba(255,200,150,0)');
	g.fillStyle = grd;
	g.fillRect(0, 0, N, N);
	return new THREE.CanvasTexture(c);
}

export class Flyby extends Effect {
	constructor() {
		super();
		this.scroll = 0;
		this.baseSpeed = 9;   // corridor units per second
		this.kickSpeed = 14;  // extra surge scaled by kick energy
		this.monoliths = [];
	}

	init(renderer) {
		// Real-time shadow maps for the whole production (only this part uses
		// them). Soft-filtered, though the 320x200 downsample softens further.
		renderer.shadowMap.enabled = true;
		renderer.shadowMap.type = THREE.PCFSoftShadowMap;

		this.scene = new THREE.Scene();
		this.camera = new THREE.PerspectiveCamera(62, FB_W / FB_H, 0.1, SPAN + 40);
		this.camera.position.set(0, EYE, 0);

		// Environment: generate the sky, run it through PMREM for image-based
		// reflections on the metal, and hang the raw map as the skybox.
		const sky = makeSkyTexture();
		const pmrem = new THREE.PMREMGenerator(renderer);
		this.envMap = pmrem.fromEquirectangular(sky).texture;
		pmrem.dispose();
		this.scene.environment = this.envMap;
		this.scene.background = sky;

		// --- Floor ---
		this.floorTex = makeFloorTexture();
		const floor = new THREE.Mesh(
			new THREE.PlaneGeometry(400, 400),
			new THREE.MeshStandardMaterial({
				map: this.floorTex,
				metalness: 0.55,   // wet sheen: it reflects the sky and the lights
				roughness: 0.35,
				envMapIntensity: 0.8,
			})
		);
		floor.rotation.x = -Math.PI / 2;
		floor.position.y = 0;
		floor.receiveShadow = true;
		this.scene.add(floor);

		// --- Monoliths: polished chrome slabs lining both sides ---
		const panel = makePanelTexture();
		const boxGeo = new THREE.BoxGeometry(1, 1, 1);
		for (let i = 0; i < PER_SIDE; i++) {
			for (const side of [-1, 1]) {
				// Each slab owns its texture so per-slab tiling (set in _reshape)
				// doesn't stomp the shared one.
				const map = panel.clone();
				map.needsUpdate = true;
				const mat = new THREE.MeshStandardMaterial({
					map,
					color: paletteColor((i / PER_SIDE) + (side > 0 ? 0.5 : 0)),
					metalness: 0.92,   // near-mirror chrome
					roughness: 0.16,
					envMapIntensity: 1.0,
				});
				const m = new THREE.Mesh(boxGeo, mat);
				m.castShadow = true;
				m.receiveShadow = true;
				m.position.x = side * LANE;
				m.position.z = -i * STEP;
				this._reshape(m);
				this.scene.add(m);
				this.monoliths.push(m);
			}
		}

		// --- Lights ---
		// Low directional sun: the shadow caster. Its ortho frustum frames the
		// near stretch of corridor, where the slabs cast moving shadows on the
		// floor as they stream past.
		this.sun = new THREE.DirectionalLight(0xffd9a0, 2.3);
		this.sun.position.set(-8, 9, -6);
		this.sun.target.position.set(0, 0, -14);
		this.sun.castShadow = true;
		this.sun.shadow.mapSize.set(1024, 1024);
		const sc = this.sun.shadow.camera;
		sc.near = 1;
		sc.far = 60;
		sc.left = -14; sc.right = 14;
		sc.top = 16; sc.bottom = -2;
		this.scene.add(this.sun);
		this.scene.add(this.sun.target);

		// Sky/ground fill so shadowed faces aren't pure black.
		this.scene.add(new THREE.HemisphereLight(0x6a78b0, 0x140a18, 0.55));

		// Two coloured key lights riding just ahead of the lens; their hue cycles
		// and intensity pulses with the tune, raking colour across the chrome as
		// the slabs pass through them.
		this.key1 = new THREE.PointLight(0xff4060, 40, 40, 2);
		this.key2 = new THREE.PointLight(0x40a0ff, 40, 40, 2);
		this.scene.add(this.key1, this.key2);

		// --- Fake lens flare ---
		// A bright sun glow far down the corridor, plus a chain of additive
		// "ghosts" parented to the camera so they hang in front of the lens and
		// always read, exactly like a 90s screen-space flare hack.
		const glow = makeGlowTexture();
		const flareMat = (scale, opacity, tint) => {
			const s = new THREE.Sprite(new THREE.SpriteMaterial({
				map: glow,
				color: tint,
				transparent: true,
				opacity,
				blending: THREE.AdditiveBlending,
				depthTest: false,
				depthWrite: false,
			}));
			s.scale.setScalar(scale);
			return s;
		};

		this.sunGlow = flareMat(36, 0.9, 0xfff0c8);
		this.sunGlow.position.set(-26, 16, -SPAN * 0.7);
		this.sunGlow.userData.base = 0.9;
		this.scene.add(this.sunGlow);

		// Ghosts strung across the frame in camera space (z in front of the lens).
		this.flare = new THREE.Group();
		const ghosts = [
			[0.18, 0.10, 0.42, 0.35, 0xfff0c8],
			[-0.10, -0.06, 0.22, 0.30, 0x9fd0ff],
			[-0.30, -0.18, 0.34, 0.25, 0xff9ad0],
			[0.34, 0.22, 0.16, 0.40, 0xffffff],
		];
		for (const [x, y, sc2, op, tint] of ghosts) {
			const s = flareMat(sc2, op, tint);
			s.position.set(x, y, -1.2); // just in front of the near plane
			s.userData.base = op;
			this.flare.add(s);
		}
		this.camera.add(this.flare);
		this.scene.add(this.camera); // so the camera-parented flare is in the graph
	}

	// Give a monolith a fresh random height (and re-seat it on the floor). Called
	// at build time and every time a slab recycles to the back.
	_reshape(m) {
		const h = 3 + Math.random() * 8;
		const w = 1.2 + Math.random() * 1.8;
		const d = 1.2 + Math.random() * 2.2;
		m.scale.set(w, h, d);
		m.position.y = h / 2;
		// Vary the window tiling with the slab's size so they don't look cloned.
		if (m.material.map) m.material.map.repeat.set(w, h);
	}

	update(ctx) {
		// Fly forward on the smooth clock; the kick surges the speed.
		const dz = (this.baseSpeed + this.kickSpeed * ctx.energy) * ctx.dt;
		this.scroll += dz;

		// Stream the slabs toward the camera and wrap them to the back when they
		// pass, re-randomising shape so the corridor never repeats.
		for (const m of this.monoliths) {
			m.position.z += dz;
			if (m.position.z > RECYCLE_Z) {
				m.position.z -= SPAN;
				this._reshape(m);
			}
		}

		// Scroll the floor grid to match, so the ground rushes past in lockstep.
		this.floorTex.offset.y = -this.scroll * 0.12;

		// Gentle camera sway/bob on the beat, looking a little ahead and into the
		// turns so the corridor feels alive without losing the forward rush.
		const swayX = Math.sin(ctx.beat * (Math.PI / 4)) * 0.55;
		const bobY = Math.sin(ctx.beat * (Math.PI / 2)) * 0.12;
		this.camera.position.x = swayX * 0.4;
		this.camera.position.y = EYE + bobY;
		this.camera.lookAt(swayX, EYE + bobY * 0.5, -14);

		// Coloured key lights: cycle hue with the bar, swing side to side, and
		// flare with the kick so the chrome flashes on the drums.
		const hue = ctx.beat * 0.25;
		this.key1.color.copy(paletteColor(hue));
		this.key2.color.copy(paletteColor(hue + 0.5));
		const lz1 = -7 + Math.sin(ctx.beat * 0.7) * 2;
		const lz2 = -13 + Math.cos(ctx.beat * 0.6) * 2;
		this.key1.position.set(Math.sin(ctx.beat) * 3, EYE + 1.5, lz1);
		this.key2.position.set(-Math.sin(ctx.beat * 0.8) * 3, EYE + 1.0, lz2);
		const lift = 30 + ctx.energy * 70;
		this.key1.intensity = lift;
		this.key2.intensity = lift;

		// The flare and its ghosts brighten with the kick too, tying the lens to
		// the beat.
		const flarePulse = 0.7 + ctx.energy * 0.9;
		this.sunGlow.material.opacity = this.sunGlow.userData.base * flarePulse;
		for (const s of this.flare.children) {
			s.material.opacity = s.userData.base * flarePulse;
		}
	}
}
