import * as turf from '@turf/turf';
import routeCoords from './route.json';
import {STOPS} from './stops';

// The map is rendered once as a large static "plate" and moved with CSS.
// MapLibre uses 512 px world tiles: worldSize = 512 * 2^zoom.
export const PLATE_W = 3840;
export const PLATE_H = 2600;
export const PLATE_ZOOM = 12;
export const PLATE_CENTER: [number, number] = [-156.229, 20.8];

const WORLD = 512 * 2 ** PLATE_ZOOM;
const mercX = (lon: number) => (lon + 180) / 360;
const mercY = (lat: number) => {
	const s = Math.sin((lat * Math.PI) / 180);
	return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
};

// Geographic coordinate -> pixel on the plate (matches map.project()).
export const toPlate = ([lon, lat]: [number, number]): [number, number] => [
	(mercX(lon) - mercX(PLATE_CENTER[0])) * WORLD + PLATE_W / 2,
	(mercY(lat) - mercY(PLATE_CENTER[1])) * WORLD + PLATE_H / 2,
];

export const route = routeCoords as [number, number][];
export const routePx = route.map(toPlate);

// Cumulative pixel length along the route.
export const cumLen: number[] = [0];
for (let i = 1; i < routePx.length; i++) {
	const [ax, ay] = routePx[i - 1];
	const [bx, by] = routePx[i];
	cumLen.push(cumLen[i - 1] + Math.hypot(bx - ax, by - ay));
}
export const totalLen = cumLen[cumLen.length - 1];
export const routeKm = turf.length(turf.lineString(route));

export const pointAtLen = (len: number): [number, number] => {
	const l = Math.min(totalLen, Math.max(0, len));
	let lo = 0;
	let hi = cumLen.length - 1;
	while (hi - lo > 1) {
		const mid = (lo + hi) >> 1;
		if (cumLen[mid] <= l) lo = mid;
		else hi = mid;
	}
	const seg = cumLen[hi] - cumLen[lo] || 1;
	const t = (l - cumLen[lo]) / seg;
	return [
		routePx[lo][0] + (routePx[hi][0] - routePx[lo][0]) * t,
		routePx[lo][1] + (routePx[hi][1] - routePx[lo][1]) * t,
	];
};

// Index of the last route vertex at or before `len` (for partial path drawing).
export const indexAtLen = (len: number) => {
	let lo = 0;
	let hi = cumLen.length - 1;
	while (hi - lo > 1) {
		const mid = (lo + hi) >> 1;
		if (cumLen[mid] <= len) lo = mid;
		else hi = mid;
	}
	return lo;
};

// Camera target: route position averaged over a window so hairpins don't shake the frame.
export const smoothedCenter = (len: number, window = 320, lead = 80): [number, number] => {
	const n = 16;
	let x = 0;
	let y = 0;
	for (let k = -n; k <= n; k++) {
		const [px, py] = pointAtLen(len + lead + (k / n) * window);
		x += px;
		y += py;
	}
	return [x / (2 * n + 1), y / (2 * n + 1)];
};

export const stopsPx = STOPS.map((s) => toPlate(s.coord));

// Position of each stop along the route (nearest route vertex).
export const stopLen = stopsPx.map(([sx, sy], i) => {
	if (i === 0) return 0;
	if (i === STOPS.length - 1) return totalLen;
	let best = 0;
	let bestD = Infinity;
	routePx.forEach(([x, y], j) => {
		const d = Math.hypot(x - sx, y - sy);
		if (d < bestD) {
			bestD = d;
			best = j;
		}
	});
	return cumLen[best];
});

// Overview camera that frames the whole route.
const xs = routePx.map((p) => p[0]);
const ys = routePx.map((p) => p[1]);
export const OVERVIEW_CENTER: [number, number] = [
	(Math.min(...xs) + Math.max(...xs)) / 2,
	(Math.min(...ys) + Math.max(...ys)) / 2 + 40,
];
export const OVERVIEW_SCALE = 0.53;
export const FOLLOW_SCALE = 0.92;
export const HOLD_SCALE = 1;

// ---- Timeline (frames @ 30 fps) ----
export const FPS = 30;
export const INTRO_HOLD = 60;
export const INTRO_ZOOM = 60;
export const STOP_HOLD = 84;
export const OUTRO = 180;

export type Segment =
	| {kind: 'intro'; start: number; end: number}
	| {kind: 'hold'; start: number; end: number; stop: number}
	| {kind: 'travel'; start: number; end: number; from: number; to: number}
	| {kind: 'outro'; start: number; end: number};

const buildTimeline = () => {
	const segs: Segment[] = [];
	let t = 0;
	segs.push({kind: 'intro', start: t, end: (t += INTRO_HOLD + INTRO_ZOOM)});
	STOPS.forEach((_, i) => {
		segs.push({kind: 'hold', start: t, end: (t += STOP_HOLD), stop: i});
		if (i < STOPS.length - 1) {
			const dist = stopLen[i + 1] - stopLen[i];
			const frames = Math.round(Math.min(130, Math.max(42, 36 + dist / 40)));
			segs.push({kind: 'travel', start: t, end: (t += frames), from: i, to: i + 1});
		}
	});
	segs.push({kind: 'outro', start: t, end: (t += OUTRO)});
	return {segs, total: t};
};

export const TIMELINE = buildTimeline();
