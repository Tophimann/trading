// @maxBarsBack 200
indicator({ onMainPanel: true, format: 'inherit', maxDrawings: 500 });

// =====================================================================
// Engulfing Fib Quartiles (FXreplay)
// - Evaluates CLOSED candles only (no repaint, no flicker)
// - One code path for chart TF and higher TFs
// - All anchoring by time (no barIndex: unreliable with maxBarsBack)
// =====================================================================

// ==================== 1. TIMEFRAMES ====================
const grpTf = 'Timeframes (Visible on Current & Lower TF)';
const useTf1 = input.bool('TF 1', true, { inline: 'tf1', group: grpTf });
const tf1 = input.timeframe('TF 1 Resolution', '60', { inline: 'tf1', group: grpTf });
const useTf2 = input.bool('TF 2', true, { inline: 'tf2', group: grpTf });
const tf2 = input.timeframe('TF 2 Resolution', '240', { inline: 'tf2', group: grpTf });
const useTf3 = input.bool('TF 3', false, { inline: 'tf3', group: grpTf });
const tf3 = input.timeframe('TF 3 Resolution', '1D', { inline: 'tf3', group: grpTf });

// ==================== 2. STANDARD DEVIATIONS ====================
const grpStd = 'Standard Deviations (STD)';
const useStd1 = input.bool('STD 1', true, { inline: 's1', group: grpStd });
const std1Val = input.float('STD 1 Level', 1.0, { step: 0.1, min: 0.1, inline: 's1', group: grpStd });
const useStd2 = input.bool('STD 2', true, { inline: 's2', group: grpStd });
const std2Val = input.float('STD 2 Level', 1.5, { step: 0.1, min: 0.1, inline: 's2', group: grpStd });
const useStd3 = input.bool('STD 3', true, { inline: 's3', group: grpStd });
const std3Val = input.float('STD 3 Level', 2.0, { step: 0.1, min: 0.1, inline: 's3', group: grpStd });
const showStdLabels = input.bool('Show STD Labels', true, { group: grpStd });

// ==================== 3. LAYOUT & HISTORY ====================
const grpStyle = 'Layout & History';
const historyCount = input.int('History (Engulfing Candles per TF)', 5, { min: 1, max: 30, group: grpStyle });
const boxWidthBars = input.int('Box Width (in TF Candles)', 3, { min: 1, max: 50, group: grpStyle });
const bullColor = input.color('Bullish Box Color', rgba(76, 175, 80, 0.18), { group: grpStyle });
const bearColor = input.color('Bearish Box Color', rgba(244, 67, 54, 0.18), { group: grpStyle });
const qColor = input.color('Quartile Line Color', rgba(120, 123, 134, 0.75), { group: grpStyle });
const stdColor = input.color('STD Line Color', rgba(255, 109, 0, 0.85), { group: grpStyle });

// Bear rule: true = close < open[1] (mirror of bull rule), false = close < close[1] (old behaviour)
const BEAR_USES_PREV_OPEN = true;

// ==================== HELPER: TIMEFRAME SIZE (MINUTES) ====================
function tfMinutes(res) {
  if (res === null || res === undefined) return NaN;
  if (typeof res === 'number') return res;
  const s = String(res).trim();
  if (s === '') return NaN;
  const parsed = /^(\d*\.?\d*)([A-Za-z]*)$/.exec(s);
  if (parsed === null) return NaN;
  const n = parsed[1] === '' ? 1 : Number(parsed[1]);
  const unit = parsed[2];
  if (unit === '') return n;
  if (unit === 'S' || unit === 's') return n / 60;
  if (unit === 'M') return n * 43200;
  if (unit === 'm' || unit === 'min') return n;
  const u = unit.toLowerCase();
  if (u === 'h') return n * 60;
  if (u === 'd') return n * 1440;
  if (u === 'w') return n * 10080;
  if (u === 'mo') return n * 43200;
  return NaN;
}

const rawChartTf =
  syminfo.timeframe !== null && syminfo.timeframe !== undefined
    ? syminfo.timeframe
    : symbol({}).resolution;
const chartMin = tfMinutes(rawChartTf);

// ==================== MTF SERIES (ONLY HIGHER TFs) ====================
const htf1 = useTf1 && tfMinutes(tf1) > chartMin ? symbol({ timeframe: tf1 }) : null;
const htf2 = useTf2 && tfMinutes(tf2) > chartMin ? symbol({ timeframe: tf2 }) : null;
const htf3 = useTf3 && tfMinutes(tf3) > chartMin ? symbol({ timeframe: tf3 }) : null;

// ==================== HELPER: OHLCT OF BAR i (CHART OR HTF) ====================
// src === null -> chart series, otherwise HTF series from symbol()
function barAt(src, i) {
  if (src === null) {
    return { t: time(i), o: open(i), h: high(i), l: low(i), c: close(i) };
  }
  return { t: src.time(i), o: src.open(i), h: src.high(i), l: src.low(i), c: src.close(i) };
}

function isValidBar(b) {
  return (
    Number.isFinite(b.t) && Number.isFinite(b.o) && Number.isFinite(b.h) &&
    Number.isFinite(b.l) && Number.isFinite(b.c)
  );
}

// ==================== HELPER: ENGULFING RULE ====================
// a = candidate (closed) candle, b = candle before it
// Returns 'bull', 'bear' or null
function engulfDir(a, b) {
  const rawBull = a.l < b.l && a.c > b.o;
  const rawBear = a.h > b.h && (BEAR_USES_PREV_OPEN ? a.c < b.o : a.c < b.c);
  if (rawBull && (!rawBear || a.c >= a.o)) return 'bull';
  if (rawBear && (!rawBull || a.c < a.o)) return 'bear';
  return null;
}

// ==================== ZONE: CREATE / UPDATE / DELETE ====================
function createZone(x1, x2, top, bot, isBull, tfTag, targetEnd) {
  const rng = top - bot;
  const lines = [];
  const texts = [];

  const boxId = rectangle.create(x1, top, x2, bot, {
    fillColor: isBull ? bullColor : bearColor,
    color: rgba(0, 0, 0, 0),
    borderColor: rgba(0, 0, 0, 0),
    borderWidth: 0,
    width: 0,
  });

  // Quartiles inside the box
  lines.push(trendLine.create(x1, bot + rng * 0.25, x2, bot + rng * 0.25, { color: qColor, style: 'dashed', width: 1 }));
  lines.push(trendLine.create(x1, bot + rng * 0.5, x2, bot + rng * 0.5, { color: qColor, style: 'solid', width: 1 }));
  lines.push(trendLine.create(x1, bot + rng * 0.75, x2, bot + rng * 0.75, { color: qColor, style: 'dashed', width: 1 }));

  // STD projections (above bull candle, below bear candle)
  const stds = [
    [useStd1, std1Val],
    [useStd2, std2Val],
    [useStd3, std3Val],
  ];
  for (let k = 0; k < stds.length; k++) {
    if (!stds[k][0]) continue;
    const lvl = stds[k][1];
    const p = isBull ? top + rng * lvl : bot - rng * lvl;
    lines.push(trendLine.create(x1, p, x2, p, { color: stdColor, style: 'dotted', width: 1 }));
    if (showStdLabels) {
      texts.push(text.create(x2, p, { text: tfTag + ' STD ' + String(lvl), color: stdColor, fontSize: 10 }));
    }
  }

  return { box: boxId, lines: lines, texts: texts, right: x2, targetEnd: targetEnd };
}

function setZoneRight(z, x2) {
  z.right = x2;
  rectangle.update(z.box, { x2: x2 });
  for (let k = 0; k < z.lines.length; k++) trendLine.update(z.lines[k], { x2: x2 });
  for (let k = 0; k < z.texts.length; k++) text.update(z.texts[k], { x: x2 });
}

function deleteZone(z) {
  rectangle.delete(z.box);
  for (let k = 0; k < z.lines.length; k++) trendLine.delete(z.lines[k]);
  for (let k = 0; k < z.texts.length; k++) text.delete(z.texts[k]);
}

// ==================== CORE: MANAGE ONE TF ====================
// Returns the new "last seen bar time" for this TF.
function manageTf(enabled, res, series, zones, prevTime) {
  if (!enabled) return prevTime;

  const tfMin = tfMinutes(res);
  if (!(tfMin > 0) || !(chartMin > 0)) return prevTime;
  if (tfMin < chartMin) return prevTime;          // lower TF than chart: not shown
  if (tfMin > chartMin && series === null) return prevTime;

  const src = tfMin === chartMin ? null : series;
  const now = time(0);
  if (!Number.isFinite(now)) return prevTime;
  const msPerMin = now < 1e11 ? 60 : 60000;       // seconds vs. milliseconds

  // 1) Grow active boxes up to the current time (never draw into the future)
  for (let i = 0; i < zones.length; i++) {
    const z = zones[i];
    if (z.right < z.targetEnd && now > z.right) setZoneRight(z, Math.min(now, z.targetEnd));
  }

  // 2) New bar on this TF? -> bar[1] has just closed and is final
  const cur = barAt(src, 0);
  if (!Number.isFinite(cur.t) || cur.t === prevTime) return prevTime;

  const a = barAt(src, 1);   // just-closed candle (candidate)
  const b = barAt(src, 2);   // candle before it
  if (!isValidBar(a) || !isValidBar(b)) return cur.t;

  const dir = engulfDir(a, b);
  if (dir !== null) {
    const targetEnd = a.t + tfMin * msPerMin * boxWidthBars;
    let right = Math.min(now, targetEnd);
    if (right <= a.t) right = now;
    zones.push(createZone(a.t, right, a.h, a.l, dir === 'bull', String(res), targetEnd));
    while (zones.length > historyCount) deleteZone(zones.shift());
  }

  return cur.t;
}

// ==================== STATE FOR 3 TIMEFRAMES ====================
var lastT1 = null;
var lastT2 = null;
var lastT3 = null;
var zones1 = [];
var zones2 = [];
var zones3 = [];

lastT1 = manageTf(useTf1, tf1, htf1, zones1, lastT1);
lastT2 = manageTf(useTf2, tf2, htf2, zones2, lastT2);
lastT3 = manageTf(useTf3, tf3, htf3, zones3, lastT3);
