// A MOD/tracker-style song: a handful of 16-row patterns, four channels
// (bass, arpeggio, lead, drums), played on a loop. Note cells are scientific
// pitch names ("A2", "C#5") or null. Drum cells are strings of trigger letters:
//   K = kick, S = snare, H = hi-hat (e.g. "KH" fires a kick and a hat).
//
// rowsPerBeat = 4 means each row is a 16th note; rows = 16 -> one bar per
// pattern. order sequences the patterns. The chord progression is the classic
// Am - F - C - G.

const _ = null;

// Am (A C E)
const P_AM = {
	bass: ['A2', _, 'E2', _, 'A2', _, 'E2', _, 'A2', _, 'E2', _, 'A2', _, 'E2', _],
	arp:  ['A4', 'C5', 'E5', 'A5', 'A4', 'C5', 'E5', 'A5', 'A4', 'C5', 'E5', 'A5', 'A4', 'C5', 'E5', 'A5'],
	lead: ['E5', _, _, _, _, _, _, _, 'C5', _, _, _, 'D5', _, _, _],
};

// F (F A C)
const P_F = {
	bass: ['F2', _, 'C3', _, 'F2', _, 'C3', _, 'F2', _, 'C3', _, 'F2', _, 'C3', _],
	arp:  ['F4', 'A4', 'C5', 'F5', 'F4', 'A4', 'C5', 'F5', 'F4', 'A4', 'C5', 'F5', 'F4', 'A4', 'C5', 'F5'],
	lead: ['F5', _, _, _, _, _, _, _, 'A5', _, _, _, 'G5', _, _, _],
};

// C (C E G)
const P_C = {
	bass: ['C2', _, 'G2', _, 'C2', _, 'G2', _, 'C2', _, 'G2', _, 'C2', _, 'G2', _],
	arp:  ['C5', 'E5', 'G5', 'C6', 'C5', 'E5', 'G5', 'C6', 'C5', 'E5', 'G5', 'C6', 'C5', 'E5', 'G5', 'C6'],
	lead: ['G5', _, _, _, _, _, _, _, 'E5', _, _, _, 'C5', _, _, _],
};

// G (G B D)
const P_G = {
	bass: ['G2', _, 'D3', _, 'G2', _, 'D3', _, 'G2', _, 'D3', _, 'G2', _, 'D3', _],
	arp:  ['G4', 'B4', 'D5', 'G5', 'G4', 'B4', 'D5', 'G5', 'G4', 'B4', 'D5', 'G5', 'G4', 'B4', 'D5', 'G5'],
	lead: ['D5', _, _, _, _, _, _, _, 'B4', _, _, _, 'D5', _, _, _],
};

// Four-on-the-floor drum line, shared by every pattern.
const DRUMS = ['KH', '', 'H', '', 'KSH', '', 'H', '', 'KH', '', 'H', '', 'KSH', '', 'H', ''];
for (const p of [P_AM, P_F, P_C, P_G]) p.drums = DRUMS;

export const SONG = {
	bpm: 125,
	rowsPerBeat: 4,
	rows: 16,
	order: [0, 1, 2, 3],
	patterns: [P_AM, P_F, P_C, P_G],
};

// Per-row info derived from an absolute row index (rows accumulate forever as
// the song loops). Used by the director to sync visuals to the music without
// touching the audio scheduler.
export function rowInfo(song, rowAbs) {
	const orderIndex = Math.floor(rowAbs / song.rows) % song.order.length;
	const patternIndex = song.order[orderIndex];
	const row = rowAbs % song.rows;
	const pattern = song.patterns[patternIndex];
	const drum = pattern.drums[row] || '';
	return {
		patternIndex,
		row,
		isPatternStart: row === 0,
		kick: drum.includes('K'),
		snare: drum.includes('S'),
	};
}
