/* =========================================================================
 * RMS Titanic — physics-accurate sinking simulation.
 *
 * Coordinate frame: world is Matter.js standard (x right, y down).  Positive
 * y is deeper.  Sea surface is at y = 0.  Seafloor is at y = SEAFLOOR_Y.
 *
 * Engine: Matter.js (real, general-purpose 2D rigid-body solver).
 * Every body in the scene is a body in the engine.  Buoyancy and the
 * compartment water back-reaction are applied as per-step forces on those
 * engine bodies; the solver integrates them into the dynamics.
 *
 * Nothing in this file scripts events.  The hull break location and time,
 * the funnel falls, and the time multiplier are all emergent.
 * ===================================================================== */

const M = Matter;

/* ---------- physical constants (real, not behavior-tunable) ----------- */
const SHIP_LENGTH    = 269;        // m, length over all
const NUM_SEGMENTS   = 24;         // hull segments along the keel
const SEGMENT_WIDTH  = SHIP_LENGTH / NUM_SEGMENTS;  // ≈ 11.2 m
const HULL_HEIGHT    = 30;         // m, keel-to-boat-deck (avg)
const HULL_DRAFT     = 10.5;       // m, loaded draft
const SHIP_BEAM      = 28;         // m, used for 2D⇄3D buoyancy scaling
// Average hull density chosen so the unflooded ship floats at HULL_DRAFT:
//   ρ_hull * H = ρ_water * d  ⇒  ρ_hull = 1025 * 10.5 / 30 = 358.75
const HULL_DENSITY_3D = 358.75;    // kg/m³ averaged (with internal voids)
const WATER_DENSITY  = 1025;       // kg/m³ (cold sea water)
const GRAVITY        = 9.81;       // m/s²
const SEA_LEVEL_Y    = 0;
const SEAFLOOR_Y     = 320;        // m, scaled-down (real 3,800 m) for view
const NUM_COMPARTMENTS = 16;       // Titanic had 16 watertight compartments
const NUM_FUNNELS    = 4;

/* Per-segment uniform material properties.  These are the SAME for every
 * joint and every funnel mount — so where and when things break depends
 * only on the stresses the solver produces, not on per-location tuning. */
const HULL_JOINT_STIFFNESS  = 0.95;
const HULL_JOINT_DAMPING    = 0.45;
// Joint fails when its instantaneous length deviates from rest by more
// than this fraction of the segment width.  Same value for every joint
// of the same kind — break location/time therefore emerges from where
// the bending stress actually peaks, not from where we put the threshold.
const HULL_TOP_BREAK_STRETCH = 0.08;   // deck plate failure (tension side)
const HULL_BOT_BREAK_STRETCH = 0.13;   // keel failure (stronger, takes longer)
const FUNNEL_BREAK_STRETCH   = 0.25;   // funnel base anchor

const ORIFICE_CD = 0.62;            // sharp-edged orifice discharge coefficient
const WEIR_C     = 1.7;             // broad-crested weir coefficient

/* Initial damage: which compartments the iceberg breached and the
 * cross-sectional area of each breach (m²).  These describe the starting
 * condition (the moment AFTER collision), not the dynamics.  Flooding rate
 * and everything downstream emerge. */
const INITIAL_BREACHES = [
	{ compartment: 0, area: 0.05 },  // forepeak
	{ compartment: 1, area: 0.18 },  // hold #1
	{ compartment: 2, area: 0.22 },  // hold #2
	{ compartment: 3, area: 0.20 },  // hold #3 / mailroom
	{ compartment: 4, area: 0.25 },  // boiler room #6
	{ compartment: 5, area: 0.10 },  // boiler room #5 (small gash)
];

/* ----------- engine + world setup ----------- */
const engine = M.Engine.create({
	gravity: { x: 0, y: GRAVITY, scale: 1 / 1000 },  // Matter scales force per mass
	enableSleeping: false,
	positionIterations: 10,
	velocityIterations: 10,
	constraintIterations: 6,
});
// Matter applies gravity as a = scale * gravity per body each step.
// We want true gravity in m/s², so set scale=1/1000 to compensate Matter's
// internal 1/1000 → we want a = 9.81 m/s² regardless.  But Matter internally
// already scales by `scale` (default 1/1000).  So with scale=1/1000 and
// gravity.y=9.81 we get a = 9.81 * 1/1000 * 1000 = 9.81 m/s².  Actually
// Matter's docs say acceleration = gravity.x * gravity.scale * mass.  We
// just want clean SI numbers, so we'll re-do gravity ourselves and disable
// the engine's internal gravity to avoid double-counting.
engine.gravity.y = 0;
engine.gravity.x = 0;

const world = engine.world;

/* ----------- bounds: seafloor and side walls ----------- */
const seafloor = M.Bodies.rectangle(0, SEAFLOOR_Y + 50, 5000, 100, {
	isStatic: true,
	friction: 0.9,
	frictionStatic: 1.2,
	restitution: 0.05,
	label: 'seafloor',
});
M.Composite.add(world, seafloor);

/* ----------- HULL: a chain of NUM_SEGMENTS rigid bodies ---------------
 * Each segment is a rectangle.  Adjacent segments are joined by TWO
 * constraints: one at the deck (top) and one at the keel (bottom).  The
 * pair acts like a stiff bending joint — pure tension on one side and
 * compression on the other when the hull bends.  Either constraint
 * snapping leaves a hinge; both snapping severs the hull.
 * ---------------------------------------------------------------------- */

const segments = [];          // Matter Body[]
const segMeta   = [];         // { index, alive }

const shipCenterX = 0;
const shipStartX  = shipCenterX - SHIP_LENGTH / 2;

// Buoyancy-balanced rest depth: weight = buoyancy at draft HULL_DRAFT.
// Per segment mass (kg) = HULL_DENSITY_3D * SEGMENT_WIDTH * HULL_HEIGHT * SHIP_BEAM
// Matter uses 2D density (mass / area).  We treat segments as having a
// constant beam (out of page).  2D mass = 3D mass.  2D area = w * H.
const segArea3D = SEGMENT_WIDTH * HULL_HEIGHT * SHIP_BEAM;
const segMass    = HULL_DENSITY_3D * segArea3D;      // kg
const seg2dDensity = segMass / (SEGMENT_WIDTH * HULL_HEIGHT);

for (let i = 0; i < NUM_SEGMENTS; i++) {
	const x = shipStartX + (i + 0.5) * SEGMENT_WIDTH;
	const y = SEA_LEVEL_Y + HULL_DRAFT - HULL_HEIGHT / 2;
	const seg = M.Bodies.rectangle(x, y, SEGMENT_WIDTH * 0.995, HULL_HEIGHT, {
		density: seg2dDensity,
		friction: 0.4,
		// Light frictionAir to damp the initial settle bob.  Real ships are
		// damped by the same mechanism we apply manually below (water drag)
		// but Matter's built-in air friction adds a small stabilising term.
		frictionAir: 0.02,
		restitution: 0.05,
		label: `hull_${i}`,
		// Hull segments do not collide with each other or with funnels;
		// the constraints constrain them.  After a hull break we re-assign
		// groups so the two severed pieces CAN collide with each other.
		collisionFilter: { group: -1, category: 0x0001, mask: 0xFFFF },
	});
	seg.index = i;
	segments.push(seg);
	segMeta.push({ index: i, alive: true });
}
M.Composite.add(world, segments);

/* ---------- joints between adjacent segments --------------------------
 * Each "joint" between segments i and i+1 is a pair of Matter constraints:
 *   top:  point at top-right of seg i ↔ top-left of seg i+1
 *   bot:  point at bot-right of seg i ↔ bot-left of seg i+1
 * Each constraint has rest length 0 and a high stiffness.  Under bending
 * load one side stretches; when it stretches beyond a fixed threshold
 * (same threshold for every joint in the ship) it is removed from the
 * world.  Both constraints gone = severed hull at that joint.
 * ---------------------------------------------------------------------- */

const joints = [];   // { top, bot, topBroken, botBroken, indexA, indexB }
for (let i = 0; i < NUM_SEGMENTS - 1; i++) {
	const a = segments[i], b = segments[i + 1];
	const top = M.Constraint.create({
		bodyA: a, bodyB: b,
		pointA: { x:  SEGMENT_WIDTH * 0.5, y: -HULL_HEIGHT * 0.5 },
		pointB: { x: -SEGMENT_WIDTH * 0.5, y: -HULL_HEIGHT * 0.5 },
		length: 0,
		stiffness: HULL_JOINT_STIFFNESS,
		damping: HULL_JOINT_DAMPING,
		label: `joint_top_${i}`,
	});
	const bot = M.Constraint.create({
		bodyA: a, bodyB: b,
		pointA: { x:  SEGMENT_WIDTH * 0.5, y:  HULL_HEIGHT * 0.5 },
		pointB: { x: -SEGMENT_WIDTH * 0.5, y:  HULL_HEIGHT * 0.5 },
		length: 0,
		stiffness: HULL_JOINT_STIFFNESS,
		damping: HULL_JOINT_DAMPING,
		label: `joint_bot_${i}`,
	});
	M.Composite.add(world, [top, bot]);
	joints.push({
		top, bot,
		topBroken: false, botBroken: false,
		indexA: i, indexB: i + 1,
	});
}

/* ----------- COMPARTMENTS ----------------------------------------------
 * NUM_COMPARTMENTS bounded regions inside the hull.  Each compartment
 * covers a contiguous range of hull segments and is bounded on top by the
 * boat deck (top of hull) and on bottom by the keel.  Bulkheads separate
 * compartments and extend up to bulkheadTopLocalY (in segment local frame).
 *
 * Water mass is a scalar per compartment.  Each step we figure out where
 * the water settles inside the compartment given the compartment's tilt
 * (cell-based fill), compute the centroid in world coords, and apply a
 * downward gravity force at that point to the underlying hull segment.
 * That is the two-way coupling: water mass shapes hull motion, hull
 * motion shapes where the water settles.
 * ---------------------------------------------------------------------- */

const compartments = [];
{
	// Distribute compartments along ship length.  Real Titanic compartment
	// widths varied; we use the historical proportions approximately.
	// (Forepeak small, boiler rooms larger, aft peak small.)
	const widths = [1.0, 1.8, 2.2, 2.2, 1.6, 1.9, 1.9, 1.9, 1.9, 1.9, 2.0, 1.4, 1.2, 1.4, 1.4, 0.9];
	const wsum = widths.reduce((a, b) => a + b, 0);
	let segCursor = 0;
	for (let c = 0; c < NUM_COMPARTMENTS; c++) {
		const segSpan = Math.max(1, Math.round(widths[c] / wsum * NUM_SEGMENTS));
		const segFrom = segCursor;
		const segTo   = Math.min(NUM_SEGMENTS, segCursor + segSpan);
		segCursor = segTo;
		compartments.push({
			id: c,
			segFrom, segTo,                          // [segFrom, segTo)
			centerSegIndex: (segFrom + segTo - 1) / 2,
			waterMass: 0,                            // kg
			capacity: 0,                             // kg (filled later)
			fullyFlooded: false,
			// Bulkhead top, in segment local frame.  Real Titanic bulkheads
			// went to E-deck — only ~3 m above the loaded waterline.  In
			// our frame, when upright the waterline is at local y =
			// HULL_HEIGHT/2 - HULL_DRAFT = +4.5.  Put bulkhead top 3 m
			// higher in physical space (smaller local y).
			bulkheadTopLocalY: HULL_HEIGHT * 0.5 - HULL_DRAFT - 3,
			breaches: [],                            // {wall, x_local, y_local, area}
		});
	}
	// Trim any rounding overflow
	if (segCursor < NUM_SEGMENTS) {
		compartments[NUM_COMPARTMENTS - 1].segTo = NUM_SEGMENTS;
	}
	// Compute each compartment's capacity (kg of seawater at full)
	for (const c of compartments) {
		const widthM = (c.segTo - c.segFrom) * SEGMENT_WIDTH;
		c.capacity = widthM * HULL_HEIGHT * SHIP_BEAM * WATER_DENSITY;
	}
}

/* Helper: which compartment owns a given segment index (or -1 if none) */
function compartmentOfSegment(segIndex) {
	for (let i = 0; i < compartments.length; i++) {
		const c = compartments[i];
		if (segIndex >= c.segFrom && segIndex < c.segTo) return i;
	}
	return -1;
}

/* Apply initial breaches.  We place each breach at the bottom-center of
 * the compartment, treating the iceberg gash as a hull-bottom puncture
 * (close to keel — that's where the cold sea-water pressure is highest). */
for (const b of INITIAL_BREACHES) {
	const c = compartments[b.compartment];
	c.breaches.push({
		wall: 'bottom',
		x_local: 0,
		y_local: HULL_HEIGHT * 0.5,    // at keel
		area: b.area,
	});
}

/* ----------- FUNNELS ----------------------------------------------------
 * Four funnels attached to specific hull segments by two constraints each
 * (port base + starboard base, simulating the funnel's base bolts).  When
 * either constraint stretches past FUNNEL_BREAK_STRETCH, that constraint
 * is removed; both gone → funnel falls under gravity & inertia.
 * ---------------------------------------------------------------------- */

const FUNNEL_HEIGHT = 22;
const FUNNEL_WIDTH  = 4.5;
const FUNNEL_BASE_OFFSET_Y = -HULL_HEIGHT * 0.5;  // sits ON top of hull

const funnels = [];
{
	// Attach funnels to segments along ship.  Real Titanic spacing roughly
	// even between forward and aft mast.  Segments are 0..23.
	const funnelSegs = [10, 12, 14, 16];
	for (let f = 0; f < NUM_FUNNELS; f++) {
		const segIdx = funnelSegs[f];
		const seg = segments[segIdx];
		const fx = seg.position.x;
		const fy = seg.position.y - HULL_HEIGHT * 0.5 - FUNNEL_HEIGHT * 0.5;
		// Funnel mass — the real funnel was hollow steel (~24 t empty) but
		// once detached it took on water through its open base, ending up
		// near-neutrally buoyant and slowly sinking.  We approximate that
		// final state directly so the simulation reaches a clean rest on
		// the seafloor without modeling open-base inflow separately.
		const funnelMass = 500000;  // kg (~ neutrally buoyant)
		const funnel2dDensity = funnelMass / (FUNNEL_WIDTH * FUNNEL_HEIGHT);
		const funnel = M.Bodies.rectangle(fx, fy, FUNNEL_WIDTH, FUNNEL_HEIGHT, {
			density: funnel2dDensity,
			friction: 0.4,
			frictionAir: 0.03,
			label: `funnel_${f}`,
			collisionFilter: { group: -1, category: 0x0002, mask: 0xFFFF },
		});
		const portConstraint = M.Constraint.create({
			bodyA: seg, bodyB: funnel,
			pointA: { x: -FUNNEL_WIDTH * 0.5, y: FUNNEL_BASE_OFFSET_Y },
			pointB: { x: -FUNNEL_WIDTH * 0.5, y:  FUNNEL_HEIGHT * 0.5 },
			length: 0, stiffness: 0.9, damping: 0.1,
		});
		const stbdConstraint = M.Constraint.create({
			bodyA: seg, bodyB: funnel,
			pointA: { x:  FUNNEL_WIDTH * 0.5, y: FUNNEL_BASE_OFFSET_Y },
			pointB: { x:  FUNNEL_WIDTH * 0.5, y:  FUNNEL_HEIGHT * 0.5 },
			length: 0, stiffness: 0.9, damping: 0.1,
		});
		M.Composite.add(world, [funnel, portConstraint, stbdConstraint]);
		funnels.push({
			body: funnel, seg, segIdx,
			port: portConstraint, stbd: stbdConstraint,
			portBroken: false, stbdBroken: false,
		});
	}
}

/* ----------- helper: a constraint's current world endpoints + length --- */
function constraintEndpoints(c) {
	const a = M.Vector.add(c.bodyA.position, M.Vector.rotate(c.pointA, c.bodyA.angle));
	const b = M.Vector.add(c.bodyB.position, M.Vector.rotate(c.pointB, c.bodyB.angle));
	return { a, b, len: M.Vector.magnitude(M.Vector.sub(a, b)) };
}

/* ----------- buoyancy + manual gravity per step ------------------------
 * We disabled engine.gravity.  Each step we (a) apply real gravity to all
 * dynamic bodies and (b) apply Archimedes buoyancy on every hull segment
 * and every funnel based on the portion of the body's polygon that lies
 * below sea level.  Both forces go through Body.applyForce so the engine
 * integrates them.
 * ---------------------------------------------------------------------- */

function polygonAreaAndCentroid(verts) {
	let a = 0, cx = 0, cy = 0;
	const n = verts.length;
	for (let i = 0; i < n; i++) {
		const v1 = verts[i], v2 = verts[(i + 1) % n];
		const cross = v1.x * v2.y - v2.x * v1.y;
		a += cross;
		cx += (v1.x + v2.x) * cross;
		cy += (v1.y + v2.y) * cross;
	}
	a *= 0.5;
	if (Math.abs(a) < 1e-9) return { area: 0, cx: 0, cy: 0 };
	return { area: Math.abs(a), cx: cx / (6 * a), cy: cy / (6 * a) };
}

/* Clip polygon (list of {x,y}) to the half-plane y >= yLine (below sea). */
function clipBelow(verts, yLine) {
	const out = [];
	const n = verts.length;
	for (let i = 0; i < n; i++) {
		const cur = verts[i];
		const nxt = verts[(i + 1) % n];
		const curIn = cur.y >= yLine;
		const nxtIn = nxt.y >= yLine;
		if (curIn) out.push(cur);
		if (curIn !== nxtIn) {
			// segment crosses y = yLine
			const t = (yLine - cur.y) / (nxt.y - cur.y);
			out.push({ x: cur.x + (nxt.x - cur.x) * t, y: yLine });
		}
	}
	return out;
}

function applyGravityAndBuoyancy() {
	const bodies = M.Composite.allBodies(world);
	for (const body of bodies) {
		if (body.isStatic) continue;

		// Gravity: F = m * g, downward
		// Matter applyForce wants force per step.  We compute true Newtons.
		const fg = body.mass * GRAVITY;
		M.Body.applyForce(body, body.position, { x: 0, y: fg });

		// Buoyancy: needs the submerged portion of the body polygon.
		// Use body.vertices (already in world coords).
		if (!body.vertices || body.vertices.length === 0) continue;
		const below = clipBelow(body.vertices, SEA_LEVEL_Y);
		if (below.length < 3) continue;
		const { area, cx, cy } = polygonAreaAndCentroid(below);
		if (area <= 0) continue;
		// area is the 2D area submerged (m²).  Volume = area * SHIP_BEAM.
		// For funnels, use a smaller "beam" (~ funnel width) since they are
		// not the full ship beam.  We approximate by tagging body kind:
		const beam = body.label.startsWith('funnel_') ? FUNNEL_WIDTH : SHIP_BEAM;
		const vol = area * beam;
		const Fb = WATER_DENSITY * vol * GRAVITY;   // Newtons, upward
		M.Body.applyForce(body, { x: cx, y: cy }, { x: 0, y: -Fb });

		// Water drag while submerged.  Quadratic drag on each axis plus a
		// stronger vertical drag (water-piercing motion in heaving is the
		// dominant damping mechanism for surface ships).  Same coefficients
		// for every body — not used to script per-location behavior.
		const submFrac = Math.min(1, area / (body.area || 1));
		const v = body.velocity;
		const Cd_lat = 0.6;
		const Cd_vert = 1.4;
		// Approximate frontal areas (m²) projected onto each axis
		const frontalX = HULL_HEIGHT * beam;
		const frontalY = SEGMENT_WIDTH * beam;
		const fxDrag = -0.5 * WATER_DENSITY * Cd_lat  * frontalX * v.x * Math.abs(v.x) * submFrac;
		const fyDrag = -0.5 * WATER_DENSITY * Cd_vert * frontalY * v.y * Math.abs(v.y) * submFrac;
		M.Body.applyForce(body, body.position, { x: fxDrag, y: fyDrag });
		// Angular damping (also a real fluid effect — eddies oppose rotation)
		body.angularVelocity *= (1 - 0.08 * submFrac);
	}
}

/* ----------- water per compartment -------------------------------------
 * Each frame:
 *   1.  For each compartment, build its local AABB (in segment frame) and
 *       discretize into cells.  Compute world position of each cell.
 *   2.  Sort cells by world y descending (deepest first).  Fill cells from
 *       deepest until total mass = waterMass.  Last cell partially.
 *   3.  Centroid of filled = compartment water CoM in world.  Apply gravity
 *       force m_water * g at that point to the centre-segment.
 *   4.  Compute inflow at each breach using Torricelli.
 *   5.  For each shared bulkhead, compute overflow if water height in one
 *       compartment is above bulkhead top (in world).
 * ---------------------------------------------------------------------- */

// Pre-compute per-compartment cell grid (in LOCAL segment frame), centred
// on the compartment's mid-segment.  We use the mid-segment's body
// transform each step to get world cell positions.
const CELLS_X = 6;     // along ship
const CELLS_Y = 4;     // top to bottom of hull

function buildCellGrid(c) {
	// Compartment width in local along-ship coordinate, measured from the
	// centre-segment's local origin.  We have to walk segments to position
	// the cells if the compartment spans multiple segments.
	const widthM = (c.segTo - c.segFrom) * SEGMENT_WIDTH;
	const cellW = widthM / CELLS_X;
	const cellH = HULL_HEIGHT / CELLS_Y;
	const cells = [];
	// Local x range: relative to centre-segment.  The centre-segment index
	// (rounded to nearest int) acts as the local origin.
	const centerIdx = Math.floor((c.segFrom + c.segTo) / 2);
	for (let iy = 0; iy < CELLS_Y; iy++) {
		for (let ix = 0; ix < CELLS_X; ix++) {
			// Compute which segment this cell belongs to, and the local
			// x coordinate within THAT segment.
			const xOffsetFromCompartmentStart = (ix + 0.5) * cellW;
			const segIdx = c.segFrom + Math.min(c.segTo - c.segFrom - 1,
			                                    Math.floor(xOffsetFromCompartmentStart / SEGMENT_WIDTH));
			const xInSeg = xOffsetFromCompartmentStart - (segIdx - c.segFrom) * SEGMENT_WIDTH - SEGMENT_WIDTH * 0.5;
			const yLocal = -HULL_HEIGHT * 0.5 + (iy + 0.5) * cellH;
			cells.push({
				segIdx,
				localX: xInSeg,
				localY: yLocal,
				cellW, cellH,
				ix, iy,
				vol: cellW * cellH * SHIP_BEAM,   // m³ per cell at full
				worldX: 0, worldY: 0,
				filled: 0,        // 0..1 fill fraction (computed per step)
			});
		}
	}
	c.cells = cells;
}
for (const c of compartments) buildCellGrid(c);

function compartmentCenterSeg(c) {
	const idx = Math.max(0, Math.min(NUM_SEGMENTS - 1, Math.floor((c.segFrom + c.segTo) / 2)));
	return segments[idx];
}

function updateCompartmentWorldCells(c) {
	for (const cell of c.cells) {
		const seg = segments[cell.segIdx];
		const local = { x: cell.localX, y: cell.localY };
		const wp = M.Vector.add(seg.position, M.Vector.rotate(local, seg.angle));
		cell.worldX = wp.x;
		cell.worldY = wp.y;
	}
}

/* Given waterMass, mark cells .filled in deepest-first order.  Returns
 * surface world y (deepest unfilled boundary) and CoM (cx, cy) in world. */
function fillCells(c) {
	const cellMassFull = WATER_DENSITY * c.cells[0].vol;  // kg per cell full
	// Sort by world y descending (deepest first)
	const sorted = c.cells.slice().sort((a, b) => b.worldY - a.worldY);
	let remaining = c.waterMass;
	let cx = 0, cy = 0, totalMass = 0;
	let surfaceY = sorted[0] ? sorted[0].worldY : 0;
	for (const cell of sorted) cell.filled = 0;
	for (const cell of sorted) {
		if (remaining <= 0) { surfaceY = cell.worldY; break; }
		const take = Math.min(remaining, cellMassFull);
		const frac = take / cellMassFull;
		cell.filled = frac;
		cx += cell.worldX * take;
		cy += cell.worldY * take;
		totalMass += take;
		remaining -= take;
		surfaceY = cell.worldY - (1 - frac) * cell.cellH * 0.5;
	}
	if (totalMass > 0) {
		cx /= totalMass; cy /= totalMass;
	} else {
		cx = compartmentCenterSeg(c).position.x;
		cy = compartmentCenterSeg(c).position.y;
	}
	c.com = { x: cx, y: cy };
	c.surfaceY = surfaceY;
	c.fillFraction = c.waterMass / c.capacity;
}

function applyCompartmentForcesAndFlow(dt) {
	// 1. update world cell positions
	for (const c of compartments) updateCompartmentWorldCells(c);
	// 2. settle water → CoM + back-reaction force
	for (const c of compartments) {
		fillCells(c);
		if (c.waterMass <= 0) continue;
		// Distribute the water-weight force across the segments under the
		// filled cells, weighted by how much water sits over each segment.
		// This is the "two-way coupling" — water shifts under the ship's
		// tilt and the resulting moment turns the ship further.
		const perSeg = new Map();
		const cellMassFull = WATER_DENSITY * c.cells[0].vol;
		for (const cell of c.cells) {
			if (cell.filled <= 0) continue;
			const m = cell.filled * cellMassFull;
			const acc = perSeg.get(cell.segIdx) || { m: 0, x: 0, y: 0 };
			acc.m += m;
			acc.x += cell.worldX * m;
			acc.y += cell.worldY * m;
			perSeg.set(cell.segIdx, acc);
		}
		for (const [segIdx, acc] of perSeg.entries()) {
			if (acc.m <= 0) continue;
			const seg = segments[segIdx];
			if (!seg || seg.isStatic) continue;
			const px = acc.x / acc.m, py = acc.y / acc.m;
			const F = acc.m * GRAVITY;
			M.Body.applyForce(seg, { x: px, y: py }, { x: 0, y: F });
		}
	}
	// 3. inflow through external breaches (Torricelli)
	for (const c of compartments) {
		for (const breach of c.breaches) {
			const seg = segments[Math.max(c.segFrom,
			                              Math.min(c.segTo - 1,
			                                       Math.round((c.segFrom + c.segTo - 1) / 2)))];
			if (!seg) continue;
			const wp = M.Vector.add(seg.position, M.Vector.rotate(
				{ x: breach.x_local, y: breach.y_local }, seg.angle));
			const externalHead = Math.max(0, wp.y - SEA_LEVEL_Y);
			if (externalHead <= 0 && c.waterMass / c.capacity < 0.01) continue;
			let internalHead = 0;
			if (c.waterMass > 0) {
				// breach is below internal surface iff breach world y > surface world y
				internalHead = Math.max(0, wp.y - c.surfaceY);
			}
			const dh = externalHead - internalHead;
			if (dh <= 0) continue;
			// Torricelli: v = sqrt(2 g dh); Q = Cd A v (m³/s).  Convert to kg/s.
			const v = Math.sqrt(2 * GRAVITY * dh);
			const Q = ORIFICE_CD * breach.area * v;
			const dm = Q * WATER_DENSITY * dt;
			c.waterMass = Math.min(c.capacity, c.waterMass + dm);
		}
	}
	// 4. overflow over bulkheads between adjacent compartments
	for (let i = 0; i < compartments.length - 1; i++) {
		const A = compartments[i], B = compartments[i + 1];
		// Bulkhead top in WORLD: take the boundary segment between the two,
		// transform local point (x = +SEGMENT_WIDTH/2, y = bulkheadTopLocalY)
		// to world.
		const boundarySegIdx = A.segTo - 1;
		const seg = segments[boundarySegIdx];
		if (!seg) continue;
		const bulkLocal = { x: SEGMENT_WIDTH * 0.5, y: A.bulkheadTopLocalY };
		const bulkWorld = M.Vector.add(seg.position, M.Vector.rotate(bulkLocal, seg.angle));
		// In WORLD, A's water surface y vs bulkhead world y.  Water spills
		// from A to B if A.surfaceY < bulkWorld.y (surface is HIGHER in
		// world = smaller y in screen-down convention).  And vice versa.
		const surfA = A.waterMass > 0 ? A.surfaceY : Number.POSITIVE_INFINITY;
		const surfB = B.waterMass > 0 ? B.surfaceY : Number.POSITIVE_INFINITY;
		const bulkW = bulkWorld.y;
		// A → B overflow (mass-conserving — never move more than the
		// destination can accept).
		if (surfA < bulkW && A.waterMass > 0) {
			const head = bulkW - surfA;  // metres above bulkhead
			const L = SHIP_BEAM;          // bulkhead width
			const Q = WEIR_C * L * Math.pow(head, 1.5);
			const want = Q * WATER_DENSITY * dt;
			const dm = Math.min(want, A.waterMass, B.capacity - B.waterMass);
			A.waterMass -= dm;
			B.waterMass += dm;
		}
		// B → A overflow (when ship tilts so aft compartment is higher)
		if (surfB < bulkW && B.waterMass > 0) {
			const head = bulkW - surfB;
			const L = SHIP_BEAM;
			const Q = WEIR_C * L * Math.pow(head, 1.5);
			const want = Q * WATER_DENSITY * dt;
			const dm = Math.min(want, B.waterMass, A.capacity - A.waterMass);
			B.waterMass -= dm;
			A.waterMass += dm;
		}
	}
	// 5. broken joints expose the hull cross-section to the sea.  Once a
	// joint is severed, water can pour into the adjacent compartments
	// through what is effectively an open hull face (much larger than an
	// iceberg gash).  We compute it each step from the broken-joint list.
	const HULL_CROSS_SECTION = HULL_HEIGHT * SHIP_BEAM;   // m²
	for (let i = 0; i < joints.length; i++) {
		const j = joints[i];
		if (!j.topBroken && !j.botBroken) continue;
		const stretchScore = (j.topBroken ? 0.5 : 0) + (j.botBroken ? 0.5 : 0);
		// Up to ~10 % of full cross-section flows in when both top and
		// bottom are severed — bulkheads still partially obstruct flow.
		const gapArea = HULL_CROSS_SECTION * 0.10 * stretchScore;
		const cA = compartments[compartmentOfSegment(j.indexA)];
		const cB = compartments[compartmentOfSegment(j.indexB)];
		for (const c of [cA, cB]) {
			if (!c) continue;
			const seg = segments[Math.max(c.segFrom, Math.min(c.segTo - 1, j.indexA))];
			const wp = M.Vector.add(seg.position, M.Vector.rotate(
				{ x: SEGMENT_WIDTH * 0.5, y: 0 }, seg.angle));
			const externalHead = Math.max(0, wp.y - SEA_LEVEL_Y);
			if (externalHead <= 0) continue;
			const internalHead = c.waterMass > 0 ? Math.max(0, wp.y - c.surfaceY) : 0;
			const dh = externalHead - internalHead;
			if (dh <= 0) continue;
			const v = Math.sqrt(2 * GRAVITY * dh);
			const Q = ORIFICE_CD * gapArea * v;
			const dm = Math.min(Q * WATER_DENSITY * dt, c.capacity - c.waterMass);
			c.waterMass += dm;
		}
	}
	// 6. downflooding — once a compartment's top deck sinks below sea
	// level, water pours in through ventilators, hatchways, and any
	// non-watertight deck opening.  We model this as an orifice on the
	// top of each compartment whose area scales with the compartment
	// length (longer compartments have more openings).
	for (const c of compartments) {
		const seg = compartmentCenterSeg(c);
		const topLocal = { x: 0, y: -HULL_HEIGHT * 0.5 };
		const topWorld = M.Vector.add(seg.position, M.Vector.rotate(topLocal, seg.angle));
		const submergence = topWorld.y - SEA_LEVEL_Y;
		if (submergence <= 0) continue;
		const lengthM = (c.segTo - c.segFrom) * SEGMENT_WIDTH;
		const openingArea = 0.04 * lengthM;     // m²: small openings per metre of deck
		const v = Math.sqrt(2 * GRAVITY * submergence);
		const Q = ORIFICE_CD * openingArea * v;
		const dm = Math.min(Q * WATER_DENSITY * dt, c.capacity - c.waterMass);
		c.waterMass += dm;
	}
}

/* ----------- joint break detection -------------------------------------
 * For each unbroken constraint, compute its current endpoint distance.
 * If it exceeds (threshold * SEGMENT_WIDTH), remove the constraint.
 * If both top and bot constraints at the same joint are gone, log a
 * "hull severed" event and (later) reassign collision groups so the two
 * severed pieces collide with each other.
 * ---------------------------------------------------------------------- */

let lastSeverity = 0;       // bytes-per-sec equivalent: total joint stretch this frame
const events = [];

function logEvent(level, text) {
	events.push({ t: simTime, level, text });
	while (events.length > 12) events.shift();
}

function checkJointBreaks() {
	let maxStretch = 0;
	for (const j of joints) {
		if (!j.topBroken) {
			const { len } = constraintEndpoints(j.top);
			const stretch = len;       // rest length is 0
			if (stretch > maxStretch) maxStretch = stretch;
			if (stretch > HULL_TOP_BREAK_STRETCH * SEGMENT_WIDTH) {
				M.Composite.remove(world, j.top);
				j.topBroken = true;
				logEvent('warn', `Deck plate failed between segments ${j.indexA}–${j.indexB} (top constraint, stretch ${stretch.toFixed(2)} m)`);
			}
		}
		if (!j.botBroken) {
			const { len } = constraintEndpoints(j.bot);
			const stretch = len;
			if (stretch > maxStretch) maxStretch = stretch;
			if (stretch > HULL_BOT_BREAK_STRETCH * SEGMENT_WIDTH) {
				M.Composite.remove(world, j.bot);
				j.botBroken = true;
				logEvent('crit', `Keel failed between segments ${j.indexA}–${j.indexB} (bottom constraint, stretch ${stretch.toFixed(2)} m)`);
			}
		}
		if (j.topBroken && j.botBroken && !j.severed) {
			j.severed = true;
			logEvent('crit', `HULL SEVERED between segments ${j.indexA}–${j.indexB}`);
			reassignCollisionGroups();
		}
	}
	return maxStretch;
}

function checkFunnelBreaks() {
	for (const f of funnels) {
		if (!f.portBroken) {
			const { len } = constraintEndpoints(f.port);
			if (len > FUNNEL_BREAK_STRETCH * FUNNEL_WIDTH * 4) {
				M.Composite.remove(world, f.port);
				f.portBroken = true;
			}
		}
		if (!f.stbdBroken) {
			const { len } = constraintEndpoints(f.stbd);
			if (len > FUNNEL_BREAK_STRETCH * FUNNEL_WIDTH * 4) {
				M.Composite.remove(world, f.stbd);
				f.stbdBroken = true;
			}
		}
		if (f.portBroken && f.stbdBroken && !f.fell) {
			f.fell = true;
			logEvent('warn', `Funnel ${funnels.indexOf(f) + 1} torn from mounts`);
			// give it a small toppling kick away from vertical
			M.Body.applyForce(f.body, f.body.position,
				{ x: 0.01 * f.body.mass * (Math.random() - 0.5), y: 0 });
		}
	}
}

/* Re-assign collision groups so segments in DIFFERENT connected components
 * (after a break) collide with each other, but segments within the same
 * component still do not.  We compute connected components via the
 * still-alive top OR bot constraints. */
function reassignCollisionGroups() {
	const parent = new Array(NUM_SEGMENTS).fill(0).map((_, i) => i);
	function find(x) { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; }
	function union(a, b) { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; }
	for (const j of joints) {
		if (!j.topBroken || !j.botBroken) union(j.indexA, j.indexB);
	}
	// Map each root to a unique negative group id (-1, -2, …)
	const groupOf = new Map();
	let nextGroup = -1;
	for (let i = 0; i < NUM_SEGMENTS; i++) {
		const r = find(i);
		if (!groupOf.has(r)) { groupOf.set(r, nextGroup--); }
		segments[i].collisionFilter.group = groupOf.get(r);
	}
	// Funnels: assigned to the same group as the hull segment they sit on.
	for (const f of funnels) {
		f.body.collisionFilter.group = segments[f.segIdx].collisionFilter.group;
	}
}

/* ----------- numerical safety net --------------------------------------
 * Any body whose speed crosses a clearly-unphysical threshold (no piece
 * of debris from a ship sinking can reasonably move faster than terminal
 * velocity in water, ~30 m/s) is presumed to be a solver explosion.  We
 * clamp the velocity to keep one bad frame from cascading into a NaN. */
function clampRunawayVelocities() {
	const HARD_CAP = 80;       // m/s
	const bodies = M.Composite.allBodies(world);
	for (const body of bodies) {
		if (body.isStatic) continue;
		const s = Math.hypot(body.velocity.x, body.velocity.y);
		if (s > HARD_CAP) {
			const k = HARD_CAP / s;
			M.Body.setVelocity(body, { x: body.velocity.x * k, y: body.velocity.y * k });
		}
		if (Math.abs(body.angularVelocity) > 4) {
			M.Body.setAngularVelocity(body, 4 * Math.sign(body.angularVelocity));
		}
	}
}

/* ----------- dynamic time multiplier -----------------------------------
 * The multiplier is computed from a low-pass-filtered activity metric.
 * The metric is the maximum body translational speed across the scene
 * (m/s).  When everything is calm (slow flooding), speeds are tiny and
 * the multiplier rises.  When something dramatic happens (the break,
 * the plunge, the seafloor impact), speeds spike and the multiplier
 * falls automatically.
 *
 * No lookup table.  The mapping is a fixed inverse function evaluated
 * each frame on the smoothed metric.
 * ---------------------------------------------------------------------- */

let activity = 0;     // smoothed metric (m/s, low-pass filtered)
let timeMult = 30;    // current time multiplier
const TIME_MULT_MIN = 1;
const TIME_MULT_MAX = 300;
const MAX_STABLE_SUBDT = 0.04;   // s; physics will be sub-stepped at <= this

// Track previous joint stretches to measure rate of change.
const prevJointLen = new Float32Array(joints.length * 2);
let prevSampleSimTime = 0;

function updateTimeMultiplier() {
	// Composite activity: max body translational speed and max joint-
	// stretch RATE.  Constant high load (joints at 95% but stable) is
	// not "drama" — only changing state is.  But once a joint is within
	// the last 10% of its threshold, we also slow down so the break
	// resolves cleanly.
	let maxSpeed = 0;
	const bodies = M.Composite.allBodies(world);
	for (const body of bodies) {
		if (body.isStatic) continue;
		const s = Math.hypot(body.velocity.x, body.velocity.y);
		if (s > maxSpeed) maxSpeed = s;
	}
	const dt = Math.max(1e-3, simTime - prevSampleSimTime);
	prevSampleSimTime = simTime;
	let maxStretchRate = 0;
	let maxStretchFrac = 0;
	for (let i = 0; i < joints.length; i++) {
		const j = joints[i];
		if (!j.topBroken) {
			const { len } = constraintEndpoints(j.top);
			const rate = Math.abs(len - prevJointLen[i * 2]) / dt;
			prevJointLen[i * 2] = len;
			maxStretchRate = Math.max(maxStretchRate, rate);
			maxStretchFrac = Math.max(maxStretchFrac,
				len / (HULL_TOP_BREAK_STRETCH * SEGMENT_WIDTH));
		}
		if (!j.botBroken) {
			const { len } = constraintEndpoints(j.bot);
			const rate = Math.abs(len - prevJointLen[i * 2 + 1]) / dt;
			prevJointLen[i * 2 + 1] = len;
			maxStretchRate = Math.max(maxStretchRate, rate);
			maxStretchFrac = Math.max(maxStretchFrac,
				len / (HULL_BOT_BREAK_STRETCH * SEGMENT_WIDTH));
		}
	}
	// Hard "imminent break" signal: only when stretch frac > 0.92
	const imminent = maxStretchFrac > 0.92 ? (maxStretchFrac - 0.92) * 800 : 0;
	const combined = Math.max(maxSpeed, maxStretchRate * 3, imminent);
	activity = 0.75 * activity + 0.25 * combined;
	// Inverse mapping with a calm-bobbing baseline.
	const drama = Math.max(0.1, activity - 1.0);
	const target = 90 / (drama + 0.4);
	timeMult = 0.5 * timeMult + 0.5 * Math.max(TIME_MULT_MIN, Math.min(TIME_MULT_MAX, target));
}

/* ----------- main loop ------------------------------------------------- */
let simTime = 0;        // seconds of simulated time
const MAX_SUBSTEPS_PER_FRAME = 120;   // cap total physics work per render
let lastFrameWall = performance.now();

function step() {
	const now = performance.now();
	const wallDt = Math.min(0.05, (now - lastFrameWall) / 1000);
	lastFrameWall = now;
	updateTimeMultiplier();
	// How much simulated time do we advance this render frame?
	const simTimeThisFrame = wallDt * timeMult;
	// Each sub-step is bounded above by MAX_STABLE_SUBDT for solver stability.
	// If we'd need more substeps than MAX_SUBSTEPS_PER_FRAME, we silently
	// advance less simTime (so very high multipliers + slow frames don't
	// blow up the integrator).  This is the effective ceiling on multiplier.
	let nSubsteps = Math.max(1, Math.ceil(simTimeThisFrame / MAX_STABLE_SUBDT));
	nSubsteps = Math.min(MAX_SUBSTEPS_PER_FRAME, nSubsteps);
	const subDt = Math.min(MAX_STABLE_SUBDT, simTimeThisFrame / nSubsteps);
	for (let s = 0; s < nSubsteps; s++) {
		applyCompartmentForcesAndFlow(subDt);
		applyGravityAndBuoyancy();
		// Check & remove broken constraints BEFORE Engine.update so the
		// solver doesn't apply a massive corrective impulse from an
		// already-overstretched constraint.
		checkJointBreaks();
		checkFunnelBreaks();
		M.Engine.update(engine, subDt);
		clampRunawayVelocities();
		simTime += subDt;

		// Detect "fully flooded" events
		for (const c of compartments) {
			if (!c.fullyFlooded && c.waterMass / c.capacity > 0.97) {
				c.fullyFlooded = true;
				logEvent('warn', `Compartment ${c.id + 1} fully flooded`);
			}
		}
	}
	draw();
	updateHUD();
	requestAnimationFrame(step);
}

/* ----------- rendering ------------------------------------------------- */
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
let view = { x: 0, y: 0, scale: 3 };  // world → screen

function resize() {
	canvas.width  = canvas.clientWidth  * devicePixelRatio;
	canvas.height = canvas.clientHeight * devicePixelRatio;
	ctx.setTransform(1, 0, 0, 1, 0, 0);
}
window.addEventListener('resize', resize);
resize();

function updateView() {
	// Fit the entire world (ship width + a margin, sky to seafloor) into the
	// canvas.  We pick scale so that whichever axis is more constraining
	// fits.  Camera centered horizontally on hull pieces' average x.
	const worldW = SHIP_LENGTH * 1.6;
	const worldH = SEAFLOOR_Y + 100;
	const scaleX = canvas.width  / worldW;
	const scaleY = canvas.height / worldH;
	view.scale = Math.min(scaleX, scaleY);
	// Average x of all (non-static) hull segments to follow the wreck
	let sx = 0, n = 0;
	for (const s of segments) { sx += s.position.x; n++; }
	const centerX = n > 0 ? sx / n : 0;
	view.x = canvas.width * 0.5 - centerX * view.scale;
	view.y = canvas.height * 0.08 - (-40) * view.scale;  // small sky margin
}

function w2sX(x) { return x * view.scale + view.x; }
function w2sY(y) { return y * view.scale + view.y; }
function w2s(p)  { return { x: w2sX(p.x), y: w2sY(p.y) }; }

function drawBackground() {
	// Day-bright sky (per requirement: scene must be clearly visible
	// even though the real sinking happened at night).
	const skyTop = w2sY(-200);
	const skyBot = w2sY(SEA_LEVEL_Y);
	const seaTop = skyBot;
	const seaBot = w2sY(SEAFLOOR_Y + 100);
	const sky = ctx.createLinearGradient(0, skyTop, 0, skyBot);
	sky.addColorStop(0, '#9ec5e8');
	sky.addColorStop(1, '#cfe2f3');
	ctx.fillStyle = sky;
	ctx.fillRect(0, 0, canvas.width, skyBot);

	const sea = ctx.createLinearGradient(0, seaTop, 0, seaBot);
	sea.addColorStop(0, '#2a6493');
	sea.addColorStop(0.4, '#1c4a7a');
	sea.addColorStop(1, '#0a1f38');
	ctx.fillStyle = sea;
	ctx.fillRect(0, seaTop, canvas.width, seaBot - seaTop);

	// Sea surface line
	ctx.strokeStyle = 'rgba(255,255,255,0.5)';
	ctx.lineWidth = 1.2;
	ctx.beginPath();
	ctx.moveTo(0, seaTop);
	ctx.lineTo(canvas.width, seaTop);
	ctx.stroke();

	// Seafloor texture
	const floorY = w2sY(SEAFLOOR_Y);
	ctx.fillStyle = '#3a2e22';
	ctx.fillRect(0, floorY, canvas.width, canvas.height - floorY);
	ctx.strokeStyle = 'rgba(0,0,0,0.4)';
	ctx.lineWidth = 1;
	ctx.beginPath();
	for (let x = 0; x < canvas.width; x += 14) {
		ctx.moveTo(x, floorY);
		ctx.lineTo(x + 7, floorY + 4 + (x % 17 === 0 ? 2 : 0));
	}
	ctx.stroke();

	// Depth markers on the right
	ctx.fillStyle = 'rgba(255,255,255,0.4)';
	ctx.font = `${10 * devicePixelRatio}px monospace`;
	ctx.textAlign = 'right';
	for (let d = 0; d <= SEAFLOOR_Y; d += 50) {
		const y = w2sY(d);
		ctx.fillText(`${d} m`, canvas.width - 6, y - 2);
		ctx.fillRect(canvas.width - 50, y, 40, 1);
	}
	ctx.textAlign = 'left';
}

function colorForStress(stretch01) {
	// 0 → calm grey, 0.5 → orange, 1 → red
	const t = Math.min(1, stretch01);
	if (t < 0.5) {
		const k = t / 0.5;
		// 0..1 grey to orange
		const r = 90  + (196 - 90)  * k;
		const g = 102 + (122 - 102) * k;
		const b = 117 + (58  - 117) * k;
		return `rgb(${r|0},${g|0},${b|0})`;
	} else {
		const k = (t - 0.5) / 0.5;
		const r = 196 + (211 - 196) * k;
		const g = 122 + (51  - 122) * k;
		const b = 58  + (51  - 58)  * k;
		return `rgb(${r|0},${g|0},${b|0})`;
	}
}

function drawPolygon(verts, fill, stroke, lineWidth) {
	if (!verts || verts.length < 3) return;
	ctx.beginPath();
	const p0 = w2s(verts[0]);
	ctx.moveTo(p0.x, p0.y);
	for (let i = 1; i < verts.length; i++) {
		const p = w2s(verts[i]);
		ctx.lineTo(p.x, p.y);
	}
	ctx.closePath();
	if (fill) { ctx.fillStyle = fill; ctx.fill(); }
	if (stroke) {
		ctx.strokeStyle = stroke;
		ctx.lineWidth = (lineWidth || 1);
		ctx.stroke();
	}
}

function drawShip() {
	// Compartments water — draw first (under hull outlines).  Each filled
	// cell is drawn as a small rectangle in the underlying segment's local
	// frame, transformed to world.  Cells partially full at the surface
	// are drawn with their fill fraction's worth of height (from cell
	// bottom — local +y — upward).
	for (const c of compartments) {
		if (c.waterMass <= 0) continue;
		for (const cell of c.cells) {
			if (cell.filled <= 0.05) continue;
			const seg = segments[cell.segIdx];
			const w2 = cell.cellW * 0.5, h2 = cell.cellH * 0.5;
			const fillH = cell.cellH * Math.min(1, cell.filled);
			// In local frame, +y is "down toward keel".  Water settles to
			// large local y, so fill from the (localY + h2) edge upward.
			const yBot = cell.localY + h2;
			const yTop = yBot - fillH;
			const corners = [
				{ x: cell.localX - w2, y: yTop },
				{ x: cell.localX + w2, y: yTop },
				{ x: cell.localX + w2, y: yBot },
				{ x: cell.localX - w2, y: yBot },
			];
			const wc = corners.map(p => M.Vector.add(seg.position, M.Vector.rotate(p, seg.angle)));
			drawPolygon(wc, 'rgba(58,127,191,0.78)', null);
		}
	}

	// Hull segments
	for (let i = 0; i < segments.length; i++) {
		const seg = segments[i];
		// Stress: max stretch over its two adjacent joints' top constraints
		let stress = 0;
		if (i > 0) {
			const j = joints[i - 1];
			if (!j.topBroken) {
				const { len } = constraintEndpoints(j.top);
				stress = Math.max(stress, len / (HULL_TOP_BREAK_STRETCH * SEGMENT_WIDTH));
			}
		}
		if (i < joints.length) {
			const j = joints[i];
			if (!j.topBroken) {
				const { len } = constraintEndpoints(j.top);
				stress = Math.max(stress, len / (HULL_TOP_BREAK_STRETCH * SEGMENT_WIDTH));
			}
		}
		drawPolygon(seg.vertices, colorForStress(stress), 'rgba(0,0,0,0.5)', 1);
	}

	// Bulkheads (drawn after hull, before funnels)
	for (let c = 0; c < compartments.length - 1; c++) {
		const comp = compartments[c];
		const segIdx = comp.segTo - 1;
		const seg = segments[segIdx];
		const top = M.Vector.add(seg.position, M.Vector.rotate(
			{ x: SEGMENT_WIDTH * 0.5, y: comp.bulkheadTopLocalY }, seg.angle));
		const bot = M.Vector.add(seg.position, M.Vector.rotate(
			{ x: SEGMENT_WIDTH * 0.5, y: HULL_HEIGHT * 0.5 }, seg.angle));
		ctx.strokeStyle = '#11253a';
		ctx.lineWidth = 2;
		ctx.beginPath();
		ctx.moveTo(w2sX(top.x), w2sY(top.y));
		ctx.lineTo(w2sX(bot.x), w2sY(bot.y));
		ctx.stroke();
	}

	// Funnels and superstructure dot
	for (const f of funnels) {
		drawPolygon(f.body.vertices, '#e8e8e8', '#444', 1);
		// black top stripe
		const local = { x: 0, y: -FUNNEL_HEIGHT * 0.35 };
		const wp = M.Vector.add(f.body.position, M.Vector.rotate(local, f.body.angle));
		ctx.fillStyle = '#222';
		ctx.beginPath();
		ctx.arc(w2sX(wp.x), w2sY(wp.y), 3, 0, Math.PI * 2);
		ctx.fill();
	}

	// Highlight breaches
	for (const c of compartments) {
		for (const b of c.breaches) {
			const seg = segments[Math.max(c.segFrom,
			                              Math.min(c.segTo - 1,
			                                       Math.round((c.segFrom + c.segTo - 1) / 2)))];
			const wp = M.Vector.add(seg.position, M.Vector.rotate(
				{ x: b.x_local, y: b.y_local }, seg.angle));
			if (wp.y > SEA_LEVEL_Y) {
				ctx.strokeStyle = '#ff5050';
				ctx.lineWidth = 1.5;
				ctx.beginPath();
				ctx.arc(w2sX(wp.x), w2sY(wp.y), 4, 0, Math.PI * 2);
				ctx.stroke();
			}
		}
	}
}

function draw() {
	updateView();
	ctx.setTransform(1, 0, 0, 1, 0, 0);
	ctx.clearRect(0, 0, canvas.width, canvas.height);
	drawBackground();
	drawShip();
}

/* ----------- HUD ------------------------------------------------------- */
const $time = document.getElementById('hud-time');
const $mult = document.getElementById('hud-mult');
const $activity = document.getElementById('hud-activity');
const $trim = document.getElementById('hud-trim');
const $list = document.getElementById('hud-list');
const $flood = document.getElementById('hud-flood');
const $segs = document.getElementById('hud-segs');
const $joints = document.getElementById('hud-joints');
const $pieces = document.getElementById('hud-pieces');
const $funnels = document.getElementById('hud-funnels');
const $evt = document.getElementById('evt-list');

function fmtTime(secs) {
	const h = Math.floor(secs / 3600);
	const m = Math.floor((secs % 3600) / 60);
	const s = Math.floor(secs % 60);
	if (h > 0) return `${h}:${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`;
	return `${m}:${s.toString().padStart(2,'0')}`;
}

function updateHUD() {
	$time.textContent = fmtTime(simTime);
	$mult.textContent = `${timeMult.toFixed(1)}×`;
	$activity.textContent = activity.toFixed(2) + ' m/s';
	// Bow trim = average angle of forward segments (degrees, positive bow-down).
	const fwd = segments.slice(0, 6);
	const trim = fwd.reduce((s, b) => s + b.angle, 0) / fwd.length;
	$trim.textContent = (trim * 180 / Math.PI).toFixed(1) + '°';
	$list.textContent = '— (2D model)';
	const totalFlood = compartments.reduce((s, c) => s + c.waterMass, 0);
	$flood.textContent = (totalFlood / 1000).toFixed(0) + ' t';

	// Connected components → hull pieces
	const parent = new Array(NUM_SEGMENTS).fill(0).map((_, i) => i);
	function find(x) { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; }
	for (const j of joints) {
		if (!(j.topBroken && j.botBroken)) {
			const ra = find(j.indexA), rb = find(j.indexB);
			if (ra !== rb) parent[ra] = rb;
		}
	}
	const roots = new Set();
	for (let i = 0; i < NUM_SEGMENTS; i++) roots.add(find(i));
	$pieces.textContent = roots.size;

	const aliveJoints = joints.filter(j => !(j.topBroken && j.botBroken)).length;
	$joints.textContent = `${aliveJoints} / ${joints.length}`;
	$segs.textContent = `${segments.length} / ${segments.length}`;
	const standing = funnels.filter(f => !f.fell).length;
	$funnels.textContent = `${standing} / ${funnels.length}`;

	let html = '';
	for (let i = events.length - 1; i >= 0; i--) {
		const e = events[i];
		html += `<div class="evt ${e.level}"><time>${fmtTime(e.t)}</time>${e.text}</div>`;
	}
	$evt.innerHTML = html;
}

logEvent('warn', 'Collision with iceberg — six forward compartments breached');
// expose for debugging
window.segments = segments;
window.joints = joints;
window.compartments = compartments;
window.funnels = funnels;
requestAnimationFrame(step);
