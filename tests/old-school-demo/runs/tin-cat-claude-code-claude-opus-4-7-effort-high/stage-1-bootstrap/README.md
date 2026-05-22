# THE 320×200 ZONE

A self-running, web-based **demoscene** production built with **Three.js** and
the **Web Audio API**. It boots, plays a looping tracker-style tune, and runs a
timeline of effects in sync with the music. No interaction beyond the single
unavoidable click that browsers demand before they will play audio.

The whole thing is rendered into a **320×200 internal framebuffer**, reduced to a
**256-colour palette**, and scaled up with hard, chunky, nearest-neighbour
pixels at a correct **4:3 aspect ratio**. Every effect draws into that tiny
framebuffer, never directly to the screen.

## Running it

It is plain ES modules; you only need a static file server (and a network
connection the first time, since Three.js loads from a CDN via an import map).

```sh
# from this directory
python3 -m http.server 8000
# then open http://localhost:8000/
```

Click (or press a key) once on the boot screen. After that it runs by itself and
loops forever.

> **Why the click?** Modern browsers block audio until a user gesture. The demo
> is otherwise fully autonomous, exactly like the productions sceners released in
> the 1990s. Visuals stay frozen on the title card until you start, so that the
> music and the timeline begin together on beat 0.

## How it works

```
src/
  main.js            bootstrap: renderer, wiring, the requestAnimationFrame loop
  clock.js           the master clock shared by visuals and audio
  framebuffer.js     the 320x200 framebuffer + palette + upscale engine
  director.js        the sequencer/timeline + music-synced signals
  font.js            bitmap-glyph factory for the scroller
  audio/
    song.js          the tune: patterns, channels, notes
    tracker.js       Web Audio playback engine (lookahead scheduler + synths)
  effects/
    effect.js        base class every effect extends
    starfield.js     3D starfield flying toward the viewer
    scroller.js      horizontal sine-scroller greeting line
```

### The framebuffer / palette engine (`framebuffer.js`)

This is the core constraint of the production, implemented as a three-pass
pipeline that runs every frame:

1. **Scene → `rtScene`.** All active effects render, in order, into an offscreen
   `WebGLRenderTarget` of exactly `320×200` (`FB_W`×`FB_H`). The first (background)
   effect paints over a cleared black frame; later effects keep the colour but
   get a fresh depth buffer, so paint order decides layering — that is how the
   scroller sits in front of the starfield.

2. **Quantise → `rtIndexed`.** A fullscreen shader reduces the frame to at most
   **256 colours**. The palette is a fixed **3-3-2-bit** palette (8 levels of red
   × 8 of green × 4 of blue = 256). A **4×4 Bayer ordered-dither** matrix is
   applied per framebuffer-pixel before snapping each channel to the palette,
   which is what produces the era's characteristic dithered gradients. A
   `uFlash` uniform adds a white pop on transitions.

3. **Upscale → screen.** `rtIndexed` (a `NearestFilter` texture) is blitted into
   a centred **4:3** viewport that fills the window, with black letterbox bars
   around it. Because the source is nearest-filtered, the upscale is hard,
   chunky pixels. (320×200 is 8:5, but CRTs displayed it at 4:3 with tall pixels;
   we reproduce that by stretching into the 4:3 box.)

The `256-colour` rule is realised as a *structured* fixed palette so it can be
evaluated per-pixel in a shader with no 256-entry nearest-colour search. See
**Using a custom palette** below to swap in an arbitrary 256-colour table (and
to enable palette cycling).

### The master clock (`clock.js`)

Visuals and audio run on two different hardware clocks (`performance.now()` for
smooth rendering, `AudioContext.currentTime` for sample-accurate scheduling).
`Clock` anchors both at the same instant in `start()`, so demo-second `s` maps to
`audioT0 + s` on the audio timeline. Effects read musical time from the clock, so
they stay locked to the tune.

### The director / timeline (`director.js`)

The director owns the clock and the tracker and drives the show:

- **Timeline.** `director.add(effect, startBeat)` schedules an effect to appear
  at a beat and persist. Each frame it builds the list of active effects (in
  insertion order = render/layer order), updates them with a per-frame `ctx`, and
  returns that list to be rendered.
- **`ctx`** carries `time`, `dt`, `beat`, `rowFloat`, `patternIndex`, and two
  music-synced transients: `energy` (spikes to 1 on each kick, then decays) and
  `flash` (spikes on each pattern change, then decays).
- These signals are derived from the song data at the current row, on the same
  clock the tracker plays from, so the visuals react on the beat without
  depending on audio callbacks.

### Music & sync (`audio/`)

`song.js` is a MOD/tracker-style score: 16-row patterns (one bar of 16th notes at
125 BPM), four channels — **bass**, **arpeggio**, **lead**, **drums** — sequenced
by an `order` array, looping forever. Note cells are pitch names (`"A2"`,
`"C#5"`); drum cells are trigger strings (`"K"` kick, `"S"` snare, `"H"` hat).

`tracker.js` plays it with the standard lookahead-scheduler pattern: a coarse
`setInterval` wakes the scheduler, which queues the next rows precisely on the
`AudioContext` clock a little ahead of time. Pitched channels are voiced with
oscillators + gain envelopes (the lead is a detuned saw pair through a lowpass);
drums are shaped noise bursts and a pitch-dropping sine kick. No sample data
ships — it is all synthesised, but voiced to sound like multi-channel sample
music.

**Sync** flows one way: the tracker and the visuals share the master clock, so
`beat`/`pattern`/`kick` computed from the song line up with what you hear. Beats
drive the scroller bob and rainbow; kicks pulse the starfield speed and bounce
the text; pattern changes flash the palette and bring new effects in.

### Effects (`effects/`)

Both implemented effects extend `Effect` (own `THREE.Scene` + camera, drawn into
the shared framebuffer):

- **Starfield** (`starfield.js`, layer 0, from beat 0) — points stream from the
  far plane toward the camera at the origin and recycle when they pass it. A
  custom point shader sizes and brightens each star by proximity (chunky square
  points), and forward speed pulses with `ctx.energy`.
- **Scroller** (`scroller.js`, layer 1, from beat 4) — one textured quad per
  glyph in an orthographic 320×200 pixel space, scrolling right-to-left along the
  bottom, each character bobbing on a travelling sine wave. Colour cycles per
  character, the line fades in, and characters bounce on the kick. Transparent
  background, so the starfield shows through.

## Adding a new effect

1. Create `src/effects/myeffect.js` extending `Effect`:

   ```js
   import * as THREE from 'three';
   import { Effect } from './effect.js';
   import { FB_W, FB_H } from '../framebuffer.js';

   export class MyEffect extends Effect {
       init() {
           this.scene = new THREE.Scene();
           this.camera = /* a camera with aspect FB_W / FB_H */;
           // build meshes...
       }
       update(ctx) {
           // animate using ctx.time / ctx.beat / ctx.energy / ctx.flash
       }
       // render() is inherited (draws this.scene with this.camera)
   }
   ```

2. Register it on the timeline in `src/main.js`:

   ```js
   import { MyEffect } from './effects/myeffect.js';
   const myEffect = new MyEffect();
   myEffect.init(renderer);
   director.add(myEffect, 16); // enter at beat 16
   ```

Effects are layered by the order they are added. If your effect is an overlay,
give its materials a transparent background and `depthTest: false` so earlier
layers show through. If it should react to the music, read the synced signals
from `ctx`. You never deal with the palette or upscale — drawing into your scene
is all that is required; the framebuffer engine handles the rest.

## Using a custom palette

The palette lives entirely in the `QUANT_FRAG` shader in `framebuffer.js`. To use
an arbitrary 256-colour table instead of the structured 3-3-2 palette, upload the
palette as a 256×1 texture, and in the shader find the nearest entry to each
pixel (a 256-iteration loop is fine at 320×200). Animating that texture between
frames gives you classic **palette cycling**. The rest of the pipeline is
unchanged.

## Tuning knobs

- **Tempo / score:** `src/audio/song.js` (`bpm`, `order`, patterns).
- **Palette / dither:** `levels` and the Bayer matrix in `framebuffer.js`.
- **Resolution:** `FB_W` / `FB_H` in `framebuffer.js` (the whole pipeline follows).
- **Scroller text:** `MESSAGE` in `src/effects/scroller.js`.
- **Starfield density / speed:** `count`, `far`, `baseSpeed` in `starfield.js`.
