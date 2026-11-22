// @maxBarsBack 200
indicator({ onMainPanel: true, format: 'inherit', maxDrawings: 500 });

// =====================================================================
// Engulfing Fib Quartiles (FXreplay) - self-aggregated HTF candles
//
// FXreplay's own 4H grid is shifted by one hour vs. the real candles
// (DST), which made HTF signals fire one LTF candle early and placed
// markers on the wrong candle. This version does NOT use symbol() for
// HTFs. It builds the HTF candles itself from the chart candles:
//  - Buckets anchored at 17:00 New York (DST-aware):
//    4H = 17/21/01/05/09/13 NY, 1D = 17:00 NY to 17:00 NY
//  - An HTF candle is evaluated only once it is COMPLETE (the first chart
//    candle of the next bucket has appeared) -> no early signal, no lookahead
//  - All drawings are anchored by bar index (bar()), never by time
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
const showBull = input.bool('Show Bullish Engulfing', true, { group: grpStyle });
const showBear = input.bool('Show Bearish Engulfing', true, { group: grpStyle });
const showConfirmMarker = input.bool('Show LTF Confirm Triangle', true, { group: grpStyle });
const historyCount = input.int('History (Engulfing Candles per TF)', 5, { min: 1, max: 30, group: grpStyle });
const boxWidthBars = input.int('Box Width (in HTF Candles)', 3, { min: 1, max: 50, group: grpStyle });
const bullColor = input.color('Bullish Box Color', rgba(76, 175, 80, 0.18), { group: grpStyle });
const bearColor = input.color('Bearish Box Color', rgba(244, 67, 54, 0.18), { group: grpStyle });
const bullMarkerColor = input.color('Bullish Confirm Triangle', rgba(76, 175, 80, 0.95), { group: grpStyle });
const bearMarkerColor = input.color('Bearish Confirm Triangle', rgba(244, 67, 54, 0.95), { group: grpStyle });
const qColor = input.color('Quartile Line Color', rgba(120, 123, 134, 0.75), { group: grpStyle });
const stdColor = input.color('STD Line Color', rgba(255, 109, 0, 0.85), { group: grpStyle });

// ==================== 4. SESSION ANCHOR ====================
const grpSess = 'HTF Candle Anchor (New York)';
const anchorHourNY = input.int('HTF Candle Anchor Hour (NY)', 17, { min: 0, max: 23, group: grpSess });
const showDebug = input.bool('Debug: show NY time + bucket of last candle', false, { group: grpSess });

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

// ==================== HELPER: NEW YORK TIME (DST-AWARE) ====================
const HOUR_MS = 3600000;

function toMs(t) {
  return t < 1e11 ? t * 1000 : t; // engine may return seconds or milliseconds
}

// n-th Sunday (1-based) of month m (0-based) in year y, as UTC midnight ms
function nthSundayUtc(y, m, n) {
  const first = Date.UTC(y, m, 1);
  const dow = new Date(first).getUTCDay();
  const firstSunday = 1 + ((7 - dow) % 7);
  return Date.UTC(y, m, firstSunday + (n - 1) * 7);
}

// US DST: 2nd Sunday of March 02:00 EST (07:00 UTC) to 1st Sunday of Nov 02:00 EDT (06:00 UTC)
function nyOffsetMs(tMs) {
  const y = new Date(tMs).getUTCFullYear();
  const dstStart = nthSundayUtc(y, 2, 2) + 7 * HOUR_MS;
  const dstEnd = nthSundayUtc(y, 10, 1) + 6 * HOUR_MS;
  return tMs >= dstStart && tMs < dstEnd ? -4 * HOUR_MS : -5 * HOUR_MS;
}

// HTF bucket number of a candle that opens at time t
function bucketKey(t, tfMin) {
  const tMs = toMs(t);
  const local = tMs + nyOffsetMs(tMs);
  const shifted = local - anchorHourNY * HOUR_MS;
  return Math.floor(shifted / (tfMin * 60000));
}

// ==================== HELPER: ENGULFING RULE (unchanged) ====================
// a = completed HTF candle, b = the one before it
function engulfDir(a, b) {
  const rawBull = a.l < b.l && a.c > b.o;
  const rawBear = a.h > b.h && a.c < b.c;
  if (rawBull && (!rawBear || a.c >= a.o)) return 'bull';
  if (rawBear && (!rawBull || a.c < a.o)) return 'bear';
  return null;
}

// ==================== ZONES (anchored by bar index) ====================
// Explicit calls (no passing of unbound methods); deletes may fail if the engine already dropped it
function delRect(id) { if (id === null || id === undefined) return; try { rectangle.delete(id); } catch (e) {} }
function delLine(id) { if (id === null || id === undefined) return; try { trendLine.delete(id); } catch (e) {} }
function delText(id) { if (id === null || id === undefined) return; try { text.delete(id); } catch (e) {} }

function deleteZone(z) {
  delRect(z.box);
  for (let k = 0; k < z.lines.length; k++) delLine(z.lines[k]);
  for (let k = 0; k < z.texts.length; k++) delText(z.texts[k]);
}

function createZone(c, isBull, tfTag, isHigherTf, ltfPerHtf) {
  const top = c.h;
  const bot = c.l;
  const rng = top - bot;
  const x1 = bar(c.firstIdx);
  const x2 = bar(c.firstIdx + boxWidthBars * ltfPerHtf);
  const lines = [];
  const texts = [];

  const boxId = rectangle.create(x1, top, x2, bot, {
    fillColor: isBull ? bullColor : bearColor,
    color: rgba(0, 0, 0, 0),
    borderColor: rgba(0, 0, 0, 0),
    borderWidth: 1,
    width: 1,
  });

  lines.push(trendLine.create(x1, bot + rng * 0.25, x2, bot + rng * 0.25, { color: qColor, style: 'dashed', width: 1 }));
  lines.push(trendLine.create(x1, bot + rng * 0.5, x2, bot + rng * 0.5, { color: qColor, style: 'solid', width: 1 }));
  lines.push(trendLine.create(x1, bot + rng * 0.75, x2, bot + rng * 0.75, { color: qColor, style: 'dashed', width: 1 }));

  // Objects (not mixed tuples) so TypeScript types 'lvl' as number
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

  // Confirm triangle on the LAST chart candle of the HTF engulfing candle
  if (showConfirmMarker && isHigherTf) {
    const gap = rng * 0.06;
    texts.push(text.create(bar(c.lastIdx), isBull ? top + gap : bot - gap, {
      text: isBull ? '▲' : '▼',
      color: isBull ? bullMarkerColor : bearMarkerColor,
      fontSize: 14,
    }));
  }

  return { box: boxId, lines: lines, texts: texts };
}

// ==================== CORE: AGGREGATE + DETECT ONE TF ====================
// st = { lastIdx, cur, prev, zones }
//  cur  = HTF candle being built   { key, o, h, l, c, firstIdx, lastIdx, valid, done }
//  prev = last COMPLETED HTF candle (valid only if it was built without gaps)
const MAX_BACKFILL = 190; // stay inside @maxBarsBack 200

function finalize(st, tfTag, isHigherTf, ltfPerHtf) {
  const c = st.cur;
  if (c === null || c.done) return;
  c.done = true;
  if (!c.valid) { st.prev = null; return; }

  if (st.prev !== null) {
    const dir = engulfDir(c, st.prev);
    if ((dir === 'bull' && showBull) || (dir === 'bear' && showBear)) {
      st.zones.push(createZone(c, dir === 'bull', tfTag, isHigherTf, ltfPerHtf));
      while (st.zones.length > historyCount) deleteZone(st.zones.shift());
    }
  }
  st.prev = c;
}

function addClosedBar(st, idx, t, o, h, l, c, tfMin, sameTf, tfTag, isHigherTf, ltfPerHtf) {
  const key = sameTf ? idx : bucketKey(t, tfMin);
  if (st.cur !== null && !st.cur.done && st.cur.key === key) {
    const b = st.cur;
    if (h > b.h) b.h = h;
    if (l < b.l) b.l = l;
    b.c = c;
    b.lastIdx = idx;
    return;
  }
  // New bucket: close the previous one (if not already closed early)
  const contiguous = st.cur !== null && st.cur.lastIdx === idx - 1;
  finalize(st, tfTag, isHigherTf, ltfPerHtf);
  st.cur = {
    key: key, o: o, h: h, l: l, c: c,
    firstIdx: idx, lastIdx: idx,
    // A bucket is only trusted if we saw its first candle right after the previous bucket
    valid: contiguous || sameTf,
    done: false,
  };
}

function manageTf(enabled, res, st) {
  if (!enabled) return;
  const tfMin = tfMinutes(res);
  if (!(tfMin > 0) || !(chartMin > 0) || tfMin < chartMin) return;
  if (tfMin > 1440) return; // W / M not supported by the NY bucket logic

  const sameTf = tfMin === chartMin;
  const isHigherTf = !sameTf;
  const ltfPerHtf = sameTf ? 1 : Math.max(1, Math.round(tfMin / chartMin));
  const tfTag = String(res);

  const target = barIndex - 1; // last CLOSED chart candle
  if (!(target >= 1)) return;

  // 1) Feed every closed chart candle we have not seen yet (handles replay jumps)
  // First run: backfill as much history as the engine gives us
  let start = st.lastIdx === null ? Math.max(1, target - MAX_BACKFILL) : st.lastIdx + 1;
  if (target - start > MAX_BACKFILL) {
    start = target - MAX_BACKFILL;
    st.cur = null;
    st.prev = null;
  }
  for (let idx = start; idx <= target; idx++) {
    const i = barIndex - idx;
    const t = time(i);
    const o = open(i);
    const h = high(i);
    const l = low(i);
    const c = close(i);
    if (!Number.isFinite(t) || !Number.isFinite(o) || !Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(c)) {
      // Data gap: nothing built across it can be trusted
      st.cur = null;
      st.prev = null;
      continue;
    }
    addClosedBar(st, idx, t, o, h, l, c, tfMin, sameTf, tfTag, isHigherTf, ltfPerHtf);
  }
  if (target > (st.lastIdx === null ? -1 : st.lastIdx)) st.lastIdx = target;

  // 2) Close the HTF candle as soon as the current chart candle belongs to the next bucket
  //    (= the HTF candle is complete; zone appears right at the HTF close, not one candle later)
  const t0 = time(0);
  if (st.cur !== null && !st.cur.done && Number.isFinite(t0)) {
    const key0 = sameTf ? barIndex : bucketKey(t0, tfMin);
    if (key0 !== st.cur.key) finalize(st, tfTag, isHigherTf, ltfPerHtf);
  }
}

// ==================== DEBUG LABEL ====================
var dbgId = null;
function debugLabel() {
  delText(dbgId);
  dbgId = null;
  if (!showDebug) return;
  const t0 = time(0);
  if (!Number.isFinite(t0)) return;
  const tMs = toMs(t0);
  const ny = new Date(tMs + nyOffsetMs(tMs));
  const hh = ny.getUTCHours();
  const mm = ny.getUTCMinutes();
  const label =
    'NY ' + (hh < 10 ? '0' : '') + String(hh) + ':' + (mm < 10 ? '0' : '') + String(mm) +
    ' | 4H bucket ' + String(bucketKey(t0, 240));
  dbgId = text.create(bar(barIndex), high(0), { text: label, color: rgba(255, 255, 255, 1), fontSize: 11 });
}

// ==================== STATE FOR 3 TIMEFRAMES ====================
var st1 = { lastIdx: null, cur: null, prev: null, zones: [] };
var st2 = { lastIdx: null, cur: null, prev: null, zones: [] };
var st3 = { lastIdx: null, cur: null, prev: null, zones: [] };

manageTf(useTf1, tf1, st1);
manageTf(useTf2, tf2, st2);
manageTf(useTf3, tf3, st3);
debugLabel();
