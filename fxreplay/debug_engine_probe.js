// @maxBarsBack 200
indicator({ onMainPanel: true, format: 'inherit', maxDrawings: 500 });

// =====================================================================
// FXreplay ENGINE PROBE - answers 3 questions about the runtime:
//  1) Does `var` state survive between ticks / bars?     -> runs, newBars
//  2) Do drawings survive the next tick?                  -> blue boxes
//  3) Does delete-by-id work across runs?                 -> HUD text
// Use on a 4H chart in replay, step tick by tick / bar by bar.
// =====================================================================

var runs = 0;
var newBars = 0;
var lastT = null;
var hud = null;

runs = runs + 1;

const t0 = time(0);
const t1 = time(1);
const barDur = Number.isFinite(t1) ? t0 - t1 : 0;

// A) One blue box per NEW bar, created once, never deleted
if (t0 !== lastT) {
  lastT = t0;
  newBars = newBars + 1;
  if (barDur > 0) {
    rectangle.create(t0, high(0), t0 + barDur, low(0), {
      fillColor: rgba(33, 150, 243, 0.3),
      color: rgba(0, 0, 0, 0),
      borderColor: rgba(0, 0, 0, 0),
      borderWidth: 0,
      width: 0,
    });
  }
}

// B) HUD text: deleted and recreated on every run
if (hud !== null) text.delete(hud);
hud = text.create(t0, high(0), {
  text: 'runs=' + String(runs) + ' newBars=' + String(newBars) + ' barIndex=' + String(barIndex),
  color: rgba(255, 255, 255, 1),
  fontSize: 12,
});
