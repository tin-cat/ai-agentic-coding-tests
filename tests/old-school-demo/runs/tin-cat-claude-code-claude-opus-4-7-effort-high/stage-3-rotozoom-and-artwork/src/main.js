import * as THREE from 'three';
import { Clock } from './clock.js';
import { Framebuffer } from './framebuffer.js';
import { Director } from './director.js';
import { Tracker } from './audio/tracker.js';
import { SONG } from './audio/song.js';
import { Starfield } from './effects/starfield.js';
import { Scroller } from './effects/scroller.js';
import { Tunnel } from './effects/tunnel.js';
import { Fire } from './effects/fire.js';
import { Rotozoom } from './effects/rotozoom.js';
import { Artwork } from './effects/artwork.js';
import { Caption } from './effects/caption.js';

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

// Build effects and lay out the timeline. Each part spans one full song cycle
// (16 beats = the Am-F-C-G progression), so cuts land on a pattern boundary.
// The whole sequence loops every 80 beats.
const starfield = new Starfield();
const scroller = new Scroller();
const tunnel = new Tunnel();
const fire = new Fire();
const rotozoom = new Rotozoom();
const artwork = new Artwork();
const credit = new Caption(
	'GRAPHICS BY  AZRAEL^SP4CE   ...   256 COLOURS, EVERY PIXEL HAND-PLACED.   ' +
	'PAINTED ON A FRIDAY NIGHT WITH TOO MUCH COFFEE.   RESPECT THE PALETTE.      '
);
starfield.init(renderer);
scroller.init(renderer);
tunnel.init(renderer);
fire.init(renderer);
rotozoom.init(renderer);
artwork.init(renderer);
credit.init(renderer);

// Part 1 - the intro: starfield backdrop + greeting scroller.
director.add(starfield, 0, 16); // background, from the first beat
director.add(scroller, 4, 16);  // greeting enters one bar in
// Part 2 - the textured, palette-cycling tunnel.
director.add(tunnel, 16, 32);
// Part 3 - the bottom-up fire.
director.add(fire, 32, 48);
// Part 4 - the rotozoomer.
director.add(rotozoom, 48, 64);
// Part 5 - the graphician's showcase: the painted image + a credit scroller.
director.add(artwork, 64, 80); // background image
director.add(credit, 64, 80);  // artist credit, layered on top

// Transitions on the pattern boundaries between parts, then loop.
director.addSeam(16, 'fade'); // intro -> tunnel: fade through the palette
director.addSeam(32, 'wipe'); // tunnel -> fire: shutter wipe
director.addSeam(48, 'fade'); // fire -> rotozoom: fade through the palette
director.addSeam(64, 'wipe'); // rotozoom -> artwork: shutter wipe
director.addSeam(80, 'fade'); // artwork -> intro: fade, on the loop point
director.setLoop(80);

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
