// Base class for a demo effect. An effect owns its own THREE.Scene + camera and
// draws into the shared 320x200 framebuffer. Background effects render first and
// opaque; overlay effects (the scroller) render later with transparent
// backgrounds so earlier layers show through.
//
// Lifecycle:
//   init(renderer)  build scene/camera/geometry once
//   update(ctx)     advance using the per-frame context from the director
//   render(renderer) draw this.scene with this.camera into the active target

export class Effect {
	constructor() {
		this.scene = null;
		this.camera = null;
		this.startBeat = 0;
	}

	init(/* renderer */) {}

	update(/* ctx */) {}

	render(renderer) {
		if (this.scene && this.camera) renderer.render(this.scene, this.camera);
	}
}
