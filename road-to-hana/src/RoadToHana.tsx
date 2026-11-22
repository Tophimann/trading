import {loadFont as loadInter} from '@remotion/google-fonts/Inter';
import {loadFont as loadPlayfair} from '@remotion/google-fonts/PlayfairDisplay';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import {useEffect, useRef, useState} from 'react';
import {
	AbsoluteFill,
	Easing,
	interpolate,
	spring,
	useCurrentFrame,
	useDelayRender,
	useVideoConfig,
} from 'remotion';
import {
	FOLLOW_SCALE,
	HOLD_SCALE,
	INTRO_HOLD,
	OVERVIEW_CENTER,
	OVERVIEW_SCALE,
	PLATE_CENTER,
	PLATE_H,
	PLATE_W,
	PLATE_ZOOM,
	TIMELINE,
	indexAtLen,
	pointAtLen,
	routeKm,
	routePx,
	smoothedCenter,
	stopLen,
	stopsPx,
	totalLen,
	type Segment,
} from './geo';
import {STOPS} from './stops';

const {fontFamily: inter} = loadInter('normal', {weights: ['400', '600', '800'], subsets: ['latin', 'latin-ext']});
const {fontFamily: playfair} = loadPlayfair('normal', {weights: ['700'], subsets: ['latin', 'latin-ext']});

const ACCENT = '#ffcf3f';
const CORAL = '#ff6b4a';

const SATELLITE_STYLE: maplibregl.StyleSpecification = {
	version: 8,
	sources: {
		sat: {
			type: 'raster',
			tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
			tileSize: 256,
			maxzoom: 18,
		},
	},
	layers: [
		{id: 'bg', type: 'background', paint: {'background-color': '#0a2a3d'}},
		{id: 'sat', type: 'raster', source: 'sat', paint: {'raster-saturation': 0.15, 'raster-contrast': 0.08}},
	],
};

const ease = Easing.bezier(0.645, 0.045, 0.355, 1);
const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;

type Camera = {center: [number, number]; scale: number};

const findSegment = (frame: number): Segment =>
	TIMELINE.segs.find((s) => frame >= s.start && frame < s.end) ?? TIMELINE.segs[TIMELINE.segs.length - 1];

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpCam = (a: Camera, b: Camera, t: number): Camera => ({
	center: [lerp(a.center[0], b.center[0], t), lerp(a.center[1], b.center[1], t)],
	scale: lerp(a.scale, b.scale, t),
});

const OVERVIEW: Camera = {center: OVERVIEW_CENTER, scale: OVERVIEW_SCALE};
const holdCam = (i: number): Camera => ({center: smoothedCenter(stopLen[i]), scale: HOLD_SCALE});

const getState = (frame: number) => {
	const seg = findSegment(frame);
	const local = frame - seg.start;
	const dur = seg.end - seg.start;

	if (seg.kind === 'intro') {
		const t = interpolate(local, [INTRO_HOLD, dur], [0, 1], {...clamp, easing: ease});
		return {seg, head: 0, cam: lerpCam(OVERVIEW, holdCam(0), t)};
	}
	if (seg.kind === 'hold') {
		return {seg, head: stopLen[seg.stop], cam: holdCam(seg.stop)};
	}
	if (seg.kind === 'travel') {
		const t = interpolate(local, [0, dur], [0, 1], {...clamp, easing: ease});
		const a = stopLen[seg.from];
		const b = stopLen[seg.to];
		const head = lerp(a, b, t);
		const dip = Math.max(0.62, FOLLOW_SCALE - (b - a) / 9000);
		const scale = HOLD_SCALE - (HOLD_SCALE - dip) * Math.sin(Math.PI * t);
		return {seg, head, cam: {center: smoothedCenter(head), scale}};
	}
	const t = interpolate(local, [0, 75], [0, 1], {...clamp, easing: ease});
	return {seg, head: totalLen, cam: lerpCam(holdCam(STOPS.length - 1), OVERVIEW, t)};
};

// Keep the viewport inside the rendered plate.
const clampCam = (cam: Camera, w: number, h: number): Camera => {
	const hw = w / 2 / cam.scale;
	const hh = h / 2 / cam.scale;
	return {
		scale: cam.scale,
		center: [
			Math.min(PLATE_W - hw, Math.max(hw, cam.center[0])),
			Math.min(PLATE_H - hh, Math.max(hh, cam.center[1])),
		],
	};
};

const pathFor = (pts: [number, number][]) =>
	pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join('');
const FULL_PATH = pathFor(routePx);

export const RoadToHana: React.FC = () => {
	const containerRef = useRef<HTMLDivElement>(null);
	const frame = useCurrentFrame();
	const {fps, width, height} = useVideoConfig();
	const {delayRender, continueRender} = useDelayRender();
	const [loadingHandle] = useState(() =>
		delayRender('Loading satellite map plate', {timeoutInMilliseconds: 120000}),
	);

	useEffect(() => {
		if (!containerRef.current) return;

		maplibregl.setWorkerUrl(
			URL.createObjectURL(
				new Blob(
					[`import "https://unpkg.com/maplibre-gl@${maplibregl.getVersion()}/dist/maplibre-gl-worker.mjs";`],
					{type: 'text/javascript'},
				),
			),
		);

		const map = new maplibregl.Map({
			container: containerRef.current,
			style: SATELLITE_STYLE,
			center: PLATE_CENTER,
			zoom: PLATE_ZOOM,
			pixelRatio: 1,
			interactive: false,
			attributionControl: false,
			fadeDuration: 0,
			canvasContextAttributes: {preserveDrawingBuffer: true},
		});
		map.on('load', () => {
			map.jumpTo({center: PLATE_CENTER, zoom: PLATE_ZOOM});
			map.once('idle', () => continueRender(loadingHandle));
		});
	}, [continueRender, loadingHandle]);

	const {seg, head, cam: rawCam} = getState(frame);
	const cam = clampCam(rawCam, width, height);
	const tx = width / 2 - cam.center[0] * cam.scale;
	const ty = height / 2 - cam.center[1] * cam.scale;
	const toScreen = ([x, y]: [number, number]): [number, number] => [x * cam.scale + tx, y * cam.scale + ty];

	const idx = indexAtLen(head);
	const headPt = pointAtLen(head);
	const travelled = pathFor([...routePx.slice(0, idx + 1), headPt]);
	const [carX, carY] = toScreen(headPt);
	const km = (head / totalLen) * routeKm;

	// Intro title
	const titleOpacity = interpolate(frame, [0, 15, INTRO_HOLD, INTRO_HOLD + 25], [0, 1, 1, 0], clamp);
	const titleY = interpolate(frame, [0, 25], [30, 0], {...clamp, easing: Easing.out(Easing.cubic)});

	// Stop card
	const activeStop = seg.kind === 'hold' ? seg.stop : -1;
	const holdLocal = seg.kind === 'hold' ? frame - seg.start : 0;
	const holdDur = seg.end - seg.start;
	const cardIn = spring({frame: holdLocal, fps, config: {damping: 16, mass: 0.7}});
	const cardOut = interpolate(holdLocal, [holdDur - 12, holdDur], [1, 0], clamp);

	// Outro
	const outroLocal = seg.kind === 'outro' ? frame - seg.start : -1;
	const outroIn = seg.kind === 'outro' ? spring({frame: outroLocal - 50, fps, config: {damping: 18}}) : 0;

	const hudOpacity = interpolate(frame, [INTRO_HOLD + 20, INTRO_HOLD + 50], [0, 1], clamp) * (1 - outroIn);

	return (
		<AbsoluteFill style={{backgroundColor: '#0a2a3d', fontFamily: inter, overflow: 'hidden'}}>
			{/* Static satellite plate, moved only with CSS */}
			<div
				style={{
					position: 'absolute',
					width: PLATE_W,
					height: PLATE_H,
					transformOrigin: '0 0',
					transform: `translate(${tx}px, ${ty}px) scale(${cam.scale})`,
				}}
			>
				<div ref={containerRef} style={{width: PLATE_W, height: PLATE_H, position: 'absolute'}} />
			</div>

			{/* Grade + vignette for legibility */}
			<AbsoluteFill
				style={{
					background:
						'radial-gradient(ellipse at center, rgba(0,0,0,0) 45%, rgba(0,15,25,0.55) 100%), linear-gradient(180deg, rgba(0,20,35,0.25), rgba(0,0,0,0) 30%, rgba(0,0,0,0) 65%, rgba(0,15,25,0.45))',
				}}
			/>

			{/* Route */}
			<svg width={width} height={height} style={{position: 'absolute', inset: 0}}>
				<g transform={`translate(${tx} ${ty}) scale(${cam.scale})`} fill="none" strokeLinecap="round" strokeLinejoin="round">
					<path d={FULL_PATH} stroke="rgba(255,255,255,0.45)" strokeWidth={3} strokeDasharray="2 9" vectorEffect="non-scaling-stroke" />
					<path d={travelled} stroke="rgba(30,10,0,0.55)" strokeWidth={13} vectorEffect="non-scaling-stroke" />
					<path d={travelled} stroke={ACCENT} strokeWidth={7} vectorEffect="non-scaling-stroke" />
				</g>
			</svg>

			{/* Stop pins */}
			{stopsPx.map((p, i) => {
				const [x, y] = toScreen(p);
				const visited = stopLen[i] <= head + 0.5;
				const active = i === activeStop;
				const pulse = active ? 1 + 0.12 * Math.sin((holdLocal / fps) * Math.PI * 2) : 1;
				const size = (active ? 46 : visited ? 34 : 26) * pulse;
				return (
					<div
						key={STOPS[i].name}
						style={{
							position: 'absolute',
							left: x - size / 2,
							top: y - size / 2,
							width: size,
							height: size,
							borderRadius: '50%',
							background: visited ? CORAL : 'rgba(255,255,255,0.85)',
							border: `${active ? 5 : 3}px solid white`,
							boxShadow: active ? `0 0 0 10px rgba(255,107,74,0.3), 0 6px 18px rgba(0,0,0,0.5)` : '0 4px 12px rgba(0,0,0,0.45)',
							color: visited ? 'white' : '#123',
							fontWeight: 800,
							fontSize: active ? 22 : 15,
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'center',
							boxSizing: 'border-box',
						}}
					>
						{i + 1}
					</div>
				);
			})}

			{/* Car */}
			{seg.kind !== 'outro' && (
				<div
					style={{
						position: 'absolute',
						left: carX - 11,
						top: carY - 11,
						width: 22,
						height: 22,
						borderRadius: '50%',
						background: 'white',
						border: `5px solid ${ACCENT}`,
						boxShadow: `0 0 24px 8px rgba(255,207,63,0.55)`,
						boxSizing: 'border-box',
					}}
				/>
			)}

			{/* Intro title */}
			<AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', opacity: titleOpacity}}>
				<div style={{transform: `translateY(${titleY}px)`, textAlign: 'center', color: 'white', textShadow: '0 4px 30px rgba(0,0,0,0.7)'}}>
					<div style={{fontSize: 30, letterSpacing: 10, fontWeight: 600, color: ACCENT}}>MAUI · HAWAIʻI</div>
					<div style={{fontFamily: playfair, fontSize: 150, lineHeight: 1.05, fontWeight: 700}}>Road to Hāna</div>
					<div style={{fontSize: 36, fontWeight: 400, marginTop: 10}}>Wailea → Hāna → Kīpahulu · {Math.round(routeKm)} km · {STOPS.length} Stopps</div>
				</div>
			</AbsoluteFill>

			{/* HUD */}
			<div
				style={{
					position: 'absolute',
					top: 48,
					right: 56,
					opacity: hudOpacity,
					color: 'white',
					textAlign: 'right',
					textShadow: '0 2px 12px rgba(0,0,0,0.8)',
				}}
			>
				<div style={{fontFamily: playfair, fontSize: 40, fontWeight: 700}}>Road to Hāna</div>
				<div style={{fontSize: 26, fontWeight: 600, marginTop: 4, fontVariantNumeric: 'tabular-nums'}}>
					<span style={{color: ACCENT}}>{km.toFixed(1)}</span> / {Math.round(routeKm)} km
				</div>
				<div style={{width: 280, height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.25)', marginTop: 10, marginLeft: 'auto'}}>
					<div style={{width: `${(head / totalLen) * 100}%`, height: '100%', borderRadius: 3, background: ACCENT}} />
				</div>
			</div>

			{/* Stop card */}
			{activeStop >= 0 && (
				<div
					style={{
						position: 'absolute',
						left: 64,
						bottom: 72,
						width: 640,
						padding: '30px 36px',
						borderRadius: 24,
						background: 'rgba(8,24,36,0.78)',
						border: '1px solid rgba(255,255,255,0.14)',
						boxShadow: '0 20px 60px rgba(0,0,0,0.45)',
						color: 'white',
						opacity: cardIn * cardOut,
						transform: `translateY(${(1 - cardIn) * 40}px)`,
					}}
				>
					<div style={{display: 'flex', alignItems: 'center', gap: 16}}>
						<div
							style={{
								width: 52,
								height: 52,
								borderRadius: '50%',
								background: CORAL,
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'center',
								fontWeight: 800,
								fontSize: 26,
							}}
						>
							{activeStop + 1}
						</div>
						<div style={{fontSize: 22, fontWeight: 600, letterSpacing: 3, color: ACCENT, textTransform: 'uppercase'}}>
							{STOPS[activeStop].tag}
						</div>
					</div>
					<div style={{fontFamily: playfair, fontSize: 60, fontWeight: 700, marginTop: 14, lineHeight: 1.1}}>
						{STOPS[activeStop].name}
					</div>
					<div style={{fontSize: 27, lineHeight: 1.4, marginTop: 12, color: 'rgba(255,255,255,0.88)'}}>
						{STOPS[activeStop].description}
					</div>
				</div>
			)}

			{/* Outro summary */}
			{seg.kind === 'outro' && (
				<div
					style={{
						position: 'absolute',
						right: 64,
						top: 48,
						padding: '36px 40px',
						borderRadius: 24,
						background: 'rgba(8,24,36,0.82)',
						border: '1px solid rgba(255,255,255,0.14)',
						color: 'white',
						opacity: outroIn,
						transform: `translateY(${(1 - outroIn) * -50}px)`,
					}}
				>
					<div style={{fontFamily: playfair, fontSize: 64, fontWeight: 700}}>Mahalo!</div>
					<div style={{display: 'flex', gap: 40, marginTop: 10}}>
						{[
							[`${Math.round(routeKm)}`, 'km'],
							['~620', 'Kurven'],
							['59', 'Brücken'],
						].map(([v, l]) => (
							<div key={l}>
								<div style={{fontSize: 46, fontWeight: 800, color: ACCENT}}>{v}</div>
								<div style={{fontSize: 22, opacity: 0.8}}>{l}</div>
							</div>
						))}
					</div>
				</div>
			)}

			<div style={{position: 'absolute', right: 20, bottom: 12, fontSize: 14, color: 'rgba(255,255,255,0.7)'}}>
				Imagery © Esri, Maxar, Earthstar Geographics · Route © OpenStreetMap contributors, OSRM
			</div>
		</AbsoluteFill>
	);
};
