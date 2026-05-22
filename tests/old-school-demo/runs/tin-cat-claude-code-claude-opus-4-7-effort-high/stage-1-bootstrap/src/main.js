import * as THREE from 'three';
import { Clock } from './clock.js';
import { Framebuffer } from './framebuffer.js';
import { Director } from './director.js';
import { Tracker } from './audio/tracker.js';
import { SONG } from './audio/song.js';
import { Starfield } from './effects/starfield.js';
import { Scroller } from './effects/scroller.js';

// Pass colours straight through: we want the exact values we author to land in
// the palette quantiser, not Three's linear<->sRGB conversion.
THREE.ColorManagement.enabled = false;

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);
renderer.setClearColor(0x000000, 1);
renderer.autoClear = false;
document.body.appendChild(renderer.domElement);

const fb = new Framebuffer(renderer);
const clock = new Clock();
const tracker = new Tracker(SONG);
const director = new Director(SONG, clock, tracker);

// Build effects and place them on the timeline.
const starfield = new Starfield();
const scroller = new Scroller();
starfield.init(renderer);
scroller.init(renderer);
director.add(starfield, 0); // background, from the first beat
director.add(scroller, 4);  // greeting enters one bar in

function resize() {
	const w = window.innerWidth;
	const h = window.innerHeight;
	renderer.setSize(w, h);
	fb.setOutputSize(w, h);
}
window.addEventListener('resize', resize);
resize();

let last = performance.now() / 1000;
function frame() {
	requestAnimationFrame(frame);
	const t = performance.now() / 1000;
	const dt = Math.min(0.05, t - last);
	last = t;

	const ctx = director.tick(dt);
	fb.render(director.active, ctx);
}
requestAnimationFrame(frame);

// Single required gesture to satisfy browser audio autoplay rules; after this
// the production runs entirely on its own.
const boot = document.getElementById('boot');
function startDemo() {
	director.start();
	boot.style.opacity = '0';
	setTimeout(() => boot.remove(), 450);
	window.removeEventListener('pointerdown', startDemo);
	window.removeEventListener('keydown', startDemo);
}
window.addEventListener('pointerdown', startDemo);
window.addEventListener('keydown', startDemo);
