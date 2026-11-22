// @maxBarsBack 200
indicator({ onMainPanel: true, format: 'inherit', maxDrawings: 500 });

// =====================================================================
// Engulfing Fib Quartiles (FXreplay)
// - Zone RECORDS (price data) are kept in state, keyed by candle time
// - Drawings are rebuilt from those records once per new bar -> if the
//   engine drops drawings, they come back on the next bar (self-healing)
// - Records are never wiped because history is missing during replay
// - Chart TF: optional signal on the current candle (candle-step replay);
//   higher TFs: closed HTF candles only
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

// ==================== 4. SIGNAL TIMING ====================
const grpSig = 'Signal Timing';
const liveSignal = input.bool('Signal on current chart candle (for candle-step replay)', true, { group: grpSig });

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

// ==================== DRAWING: REBUILD FROM RECORDS ====================
// ids: [{k:'r'|'l'|'t', id}] - every drawing this TF currently owns
function clearIds(ids) {
  for (let k = 0; k < ids.length; k++) {
    const d = ids[k];
    try {
      if (d.k === 'r') rectangle.delete(d.id);
      else if (d.k === 'l') trendLine.delete(d.id);
      else text.delete(d.id);
    } catch (e) {}
  }
  ids.length = 0;
}

function reg(ids, kind, id) {
  if (id !== null && id !== undefined) ids.push({ k: kind, id: id });
}

function drawRecord(ids, r, now, tfTag) {
  const top = r.top;
  const bot = r.bot;
  const rng = top - bot;
  const x1 = r.key;
  let x2 = Math.min(now, r.targetEnd);           // never draw into the future
  if (x2 <= x1) x2 = r.targetEnd;                 // zone on the current candle: show full width

  reg(ids, 'r', rectangle.create(x1, top, x2, bot, {
    fillColor: r.bull ? bullColor : bearColor,
    color: rgba(0, 0, 0, 0),
    borderColor: rgba(0, 0, 0, 0),
    borderWidth: 0,
    width: 0,
  }));

  // Quartiles inside the box
  reg(ids, 'l', trendLine.create(x1, bot + rng * 0.25, x2, bot + rng * 0.25, { color: qColor, style: 'dashed', width: 1 }));
  reg(ids, 'l', trendLine.create(x1, bot + rng * 0.5, x2, bot + rng * 0.5, { color: qColor, style: 'solid', width: 1 }));
  reg(ids, 'l', trendLine.create(x1, bot + rng * 0.75, x2, bot + rng * 0.75, { color: qColor, style: 'dashed', width: 1 }));

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
    const p = r.bull ? top + rng * lvl : bot - rng * lvl;
    reg(ids, 'l', trendLine.create(x1, p, x2, p, { color: stdColor, style: 'dotted', width: 1 }));
    if (showStdLabels) {
      reg(ids, 't', text.create(x2, p, { text: tfTag + ' STD ' + String(lvl), color: stdColor, fontSize: 10 }));
    }
  }
}

// ==================== RECORDS ====================
function findRec(recs, key) {
  for (let k = 0; k < recs.length; k++) if (recs[k].key === key) return k;
  return -1;
}

// Returns true if the record list changed
function upsertSignal(recs, a, b, span, allowRemove) {
  const idx = findRec(recs, a.t);
  const dir = engulfDir(a, b);
  if (dir === null) {
    if (allowRemove && idx >= 0) { recs.splice(idx, 1); return true; }
    return false;
  }
  const rec = { key: a.t, top: a.h, bot: a.l, bull: dir === 'bull', targetEnd: a.t + span };
  if (idx < 0) { recs.push(rec); return true; }
  const old = recs[idx];
  if (old.top !== rec.top || old.bot !== rec.bot || old.bull !== rec.bull) { recs[idx] = rec; return true; }
  return false;
}

// ==================== CORE: MANAGE ONE TF ====================
const MAX_SCAN = 195; // stay inside @maxBarsBack 200 (we read i and i+1)

// st = { recs: [], ids: [], lastDrawT: null }
function manageTf(enabled, res, series, st) {
  if (!enabled) { if (st.ids.length > 0) clearIds(st.ids); return; }

  const tfMin = tfMinutes(res);
  if (!(tfMin > 0) || !(chartMin > 0)) return;
  if (tfMin < chartMin) return;                 // lower TF than chart: not shown
  if (tfMin > chartMin && series === null) return;

  const src = tfMin === chartMin ? null : series;
  const now = time(0);
  if (!Number.isFinite(now)) return;
  const msPerMin = now < 1e11 ? 60 : 60000;     // seconds vs. milliseconds
  const span = tfMin * msPerMin * boxWidthBars;
  let changed = false;

  // 1) Current candle (chart TF only): in candle-step replay it is already complete
  if (src === null && liveSignal) {
    const c0 = barAt(src, 0);
    const c1 = barAt(src, 1);
    if (isValidBar(c0) && isValidBar(c1)) {
      if (upsertSignal(st.recs, c0, c1, span, true)) changed = true;
    }
  }

  // 2) Closed candles: i = 1 is final (and may correct a provisional signal),
  //    deeper bars only ADD missing records. Missing data never removes anything.
  for (let i = 1; i <= MAX_SCAN; i++) {
    const a = barAt(src, i);
    const b = barAt(src, i + 1);
    if (!isValidBar(a) || !isValidBar(b)) break;
    if (st.recs.length >= historyCount && a.t < st.recs[0].key) break;
    if (upsertSignal(st.recs, a, b, span, i === 1)) changed = true;
  }

  // 3) Keep newest `historyCount` records
  st.recs.sort(function (p, q) { return p.key - q.key; });
  while (st.recs.length > historyCount) { st.recs.shift(); changed = true; }

  // 4) Rebuild drawings when records changed or a new bar started (self-healing)
  if (changed || now !== st.lastDrawT) {
    clearIds(st.ids);
    for (let k = 0; k < st.recs.length; k++) drawRecord(st.ids, st.recs[k], now, String(res));
    st.lastDrawT = now;
  }
}

// ==================== STATE FOR 3 TIMEFRAMES ====================
var st1 = { recs: [], ids: [], lastDrawT: null };
var st2 = { recs: [], ids: [], lastDrawT: null };
var st3 = { recs: [], ids: [], lastDrawT: null };

manageTf(useTf1, tf1, htf1, st1);
manageTf(useTf2, tf2, htf2, st2);
manageTf(useTf3, tf3, htf3, st3);
