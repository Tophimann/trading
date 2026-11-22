// @maxBarsBack 200
indicator({ onMainPanel: true, format: 'inherit', maxDrawings: 500 });

// =====================================================================
// Engulfing Fib Quartiles (FXreplay)
// - Evaluates CLOSED candles only (no repaint)
// - Incremental & keyed by candle time: draw once, never wipe on missing data
// - One code path for chart TF and higher TFs, anchored by time
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
function createZone(key, x1, x2, top, bot, isBull, tfTag, targetEnd) {
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
  // Objects (not mixed tuples) so TypeScript types 'lvl' as number, not boolean | number
  const stds = [
    { on: useStd1, lvl: std1Val },
    { on: useStd2, lvl: std2Val },
    { on: useStd3, lvl: std3Val },
  ];
  for (let k = 0; k < stds.length; k++) {
    if (!stds[k].on) continue;
    const lvl = Number(stds[k].lvl);
    const p = isBull ? top + rng * lvl : bot - rng * lvl;
    lines.push(trendLine.create(x1, p, x2, p, { color: stdColor, style: 'dotted', width: 1 }));
    if (showStdLabels) {
      texts.push(text.create(x2, p, { text: tfTag + ' STD ' + String(lvl), color: stdColor, fontSize: 10 }));
    }
  }

  return { key: key, box: boxId, lines: lines, texts: texts, right: x2, targetEnd: targetEnd };
}

function setZoneRight(z, x2) {
  z.right = x2;
  rectangle.update(z.box, { x2: x2 });
  for (let k = 0; k < z.lines.length; k++) trendLine.update(z.lines[k], { x2: x2 });
  for (let k = 0; k < z.texts.length; k++) text.update(z.texts[k], { x: x2 });
}

function deleteZone(z) {
  try { rectangle.delete(z.box); } catch (e) {}
  for (let k = 0; k < z.lines.length; k++) { try { trendLine.delete(z.lines[k]); } catch (e) {} }
  for (let k = 0; k < z.texts.length; k++) { try { text.delete(z.texts[k]); } catch (e) {} }
}

function hasKey(zones, key) {
  for (let k = 0; k < zones.length; k++) if (zones[k].key === key) return true;
  return false;
}

// ==================== CORE: MANAGE ONE TF (INCREMENTAL, KEYED) ====================
// Rules learned from the FXreplay engine:
//  - Never wipe drawings because history looks empty: deep lookback may be
//    unavailable during replay steps. Missing data => keep what we have.
//  - Each zone is keyed by its candle time -> never drawn twice.
//  - Only delete when a zone falls out of `historyCount`.
//  - Scanning back (i = 1..MAX_SCAN) fills gaps after replay jumps when the
//    data is available; if it is not, nothing is lost.
const MAX_SCAN = 195; // stay inside @maxBarsBack 200 (we read i and i+1)

function manageTf(enabled, res, series, zones) {
  if (!enabled) return;

  const tfMin = tfMinutes(res);
  if (!(tfMin > 0) || !(chartMin > 0)) return;
  if (tfMin < chartMin) return;                 // lower TF than chart: not shown
  if (tfMin > chartMin && series === null) return;

  const src = tfMin === chartMin ? null : series;
  const now = time(0);
  if (!Number.isFinite(now)) return;
  const msPerMin = now < 1e11 ? 60 : 60000;     // seconds vs. milliseconds
  const span = tfMin * msPerMin * boxWidthBars;
  const tag = String(res);

  // 1) Grow active boxes up to the current time (never draw into the future)
  for (let k = 0; k < zones.length; k++) {
    const z = zones[k];
    if (z.right < z.targetEnd && now > z.right) setZoneRight(z, Math.min(now, z.targetEnd));
  }

  // 2) Add missing zones from CLOSED candles (i = 1 is the last closed one)
  for (let i = 1; i <= MAX_SCAN; i++) {
    const a = barAt(src, i);
    const b = barAt(src, i + 1);
    if (!isValidBar(a) || !isValidBar(b)) break;  // no more data: stop, delete nothing

    // Already full and this candle is older than everything we keep -> done
    if (zones.length >= historyCount && a.t <= zones[0].key) break;
    if (hasKey(zones, a.t)) continue;

    const dir = engulfDir(a, b);
    if (dir === null) continue;

    const targetEnd = a.t + span;
    let right = Math.min(now, targetEnd);
    if (right <= a.t) right = now;
    zones.push(createZone(a.t, a.t, right, a.h, a.l, dir === 'bull', tag, targetEnd));
    zones.sort(function (p, q) { return p.key - q.key; });
  }

  // 3) Trim to history (oldest first)
  while (zones.length > historyCount) deleteZone(zones.shift());
}

// ==================== STATE FOR 3 TIMEFRAMES ====================
var zones1 = [];
var zones2 = [];
var zones3 = [];

manageTf(useTf1, tf1, htf1, zones1);
manageTf(useTf2, tf2, htf2, zones2);
manageTf(useTf3, tf3, htf3, zones3);
