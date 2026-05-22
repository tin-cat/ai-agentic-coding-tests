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
import { Glenz } from './effects/glenz.js';
import { Flyby } from './effects/flyby.js';
import { Artwork } from './effects/artwork.js';
import { Caption } from './effects/caption.js';
import { Credits } from './effects/credits.js';

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
const glenz = new Glenz();
const flyby = new Flyby();
const artwork = new Artwork();
const credit = new Caption(
	'GRAPHICS BY  AZRAEL^SP4CE   ...   256 COLOURS, EVERY PIXEL HAND-PLACED.   ' +
	'PAINTED ON A FRIDAY NIGHT WITH TOO MUCH COFFEE.   RESPECT THE PALETTE.      '
);
const credits = new Credits();
starfield.init(renderer);
scroller.init(renderer);
tunnel.init(renderer);
fire.init(renderer);
rotozoom.init(renderer);
glenz.init(renderer);
flyby.init(renderer);
artwork.init(renderer);
credit.init(renderer);
credits.init(renderer);

// Part 1 - the intro: starfield backdrop + greeting scroller.
director.add(starfield, 0, 16); // background, from the first beat
director.add(scroller, 4, 16);  // greeting enters one bar in
// Part 2 - the textured, palette-cycling tunnel.
director.add(tunnel, 16, 32);
// Part 3 - the bottom-up fire.
director.add(fire, 32, 48);
// Part 4 - the rotozoomer.
director.add(rotozoom, 48, 64);
// Part 5 - the glenz vector: a transparent 3D solid tumbling in space.
director.add(glenz, 64, 80);
// Part 6 - the 3D fly-by: the chrome-corridor showpiece.
director.add(flyby, 80, 96);
// Part 7 - the graphician's showcase: the painted image + a credit scroller.
director.add(artwork, 96, 112); // background image
director.add(credit, 96, 112);  // artist credit, layered on top
// Part 8 - the obligatory end-part: the credits roll scrolling up over the
// starfield (reused from the intro as the backdrop) while the tune plays out one
// last time, after which the production ends.
director.add(starfield, 112, 168); // backdrop, reused from the intro
director.add(credits, 112, 168);   // the credits roll, layered on top

// Transitions on the pattern boundaries between parts, then the demo ends.
director.addSeam(16, 'fade');  // intro -> tunnel: fade through the palette
director.addSeam(32, 'wipe');  // tunnel -> fire: shutter wipe
director.addSeam(48, 'fade');  // fire -> rotozoom: fade through the palette
director.addSeam(64, 'wipe');  // rotozoom -> glenz: shutter wipe
director.addSeam(80, 'fade');  // glenz -> fly-by: fade through the palette
director.addSeam(96, 'wipe');  // fly-by -> artwork: shutter wipe
director.addSeam(112, 'fade'); // artwork -> credits: fade through the palette
director.addSeam(168, 'fade'); // credits -> end: final fade to black
director.setEnd(168);          // play straight through once, then finish

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
