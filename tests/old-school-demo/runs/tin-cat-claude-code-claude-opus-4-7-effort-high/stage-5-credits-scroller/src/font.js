import * as THREE from 'three';

// Bitmap glyph factory for the scroller. Each unique character is rendered once
// into a small offscreen canvas (smoothing off so edges stay hard) and cached
// as a NearestFilter texture. The scroller maps one textured quad per glyph, so
// no UV-atlas bookkeeping is needed. Letting these crisp glyphs run through the
// 320x200 framebuffer + nearest upscale is what makes them read as chunky
// pixel-font text.

const cache = new Map();
const CELL = 48;

export function glyphTexture(ch) {
	if (cache.has(ch)) return cache.get(ch);

	const c = document.createElement('canvas');
	c.width = c.height = CELL;
	const g = c.getContext('2d');
	g.imageSmoothingEnabled = false;
	g.clearRect(0, 0, CELL, CELL);
	g.fillStyle = '#ffffff';
	g.font = `bold ${Math.round(CELL * 0.82)}px "Arial Black", "Helvetica", sans-serif`;
	g.textAlign = 'center';
	g.textBaseline = 'middle';
	g.fillText(ch, CELL / 2, CELL / 2 + 2);

	const tex = new THREE.CanvasTexture(c);
	tex.magFilter = THREE.NearestFilter;
	tex.minFilter = THREE.NearestFilter;
	tex.generateMipmaps = false;
	tex.needsUpdate = true;

	cache.set(ch, tex);
	return tex;
}
