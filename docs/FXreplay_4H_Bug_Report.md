**Subject:** Custom indicator scripts behave unreliably on the 4H timeframe in replay (1H and 1D work)

**Summary**
On the 4H chart, custom indicator scripts do not run or render reliably during replay. Drawings appear briefly and then disappear, or are not created at all. The same scripts work correctly on 1H and 1D. The problem can be reproduced with a 40-line script that has no trading logic. Drawing 4H data on a 1H chart through `symbol({ timeframe: '240' })` also works correctly, so the problem is specific to the 4H chart itself.

**Environment**
- FXreplay web, replay mode
- Symbols tested: XAUUSD (FXReplay), XAGUSD (OANDA)
- Timeframes: 4H (broken), 1H and 1D (working)

**Steps to reproduce**
1. Open XAUUSD in replay mode on a new 4H layout.
2. Add the attached script `debug_engine_probe.js`. Per run, it draws one rectangle for each new bar, and it keeps one text label showing a run counter, a new-bar counter and `barIndex`.
3. Look at the chart right after it loads.
4. Step forward bar by bar for 10 to 20 bars, then do one jump forward.
5. Repeat the same steps on 1H and 1D.

**Expected behaviour (what 1H and 1D show)**
- Every bar has one rectangle, and the rectangles stay.
- There is exactly one text label, and its counters go up by 1 per bar.

**Actual behaviour on 4H**
Over several sessions we saw the following, and it is inconsistent:
1. Drawings created on load appear for a split second and then disappear.
2. Bars added during replay get no new drawings, even though the script creates one per new bar.
3. In one session the script ran, but it was not called for 12 consecutive bars: the new-bar counter went up by 1 while `barIndex` went up by 13 (110344 → 110357).
4. Two text labels were visible at once, even though the script deletes the old label before it creates a new one. So either deleting by ID failed, or an earlier script instance left its drawing behind.
5. After switching from 1H to 4H, drawings from the 1H instance stayed visible on the 4H chart.

**Key observation: the 4H time axis is off by one hour**
On XAUUSD 4H (replay date: 26 May 2020), the crosshair shows a candle open of **17:00**, but a vertical line snapped to that same candle shows **18:00**. On the next candle, the line shows 21:00. The time axis labels also jump 8 hours between two neighbouring 4H candles (09:00 → 17:00) on Mon 25 May 2020. So on 4H, candle timestamps and the drawing time axis do not match. Drawings anchored to a candle's timestamp can end up between candles, which would explain why they disappear. On 1H every full hour is a candle, so the same offset just shifts the drawing by one candle, and on 1D it gets lost within the day.

**What we ruled out**
- **Script logic:** The probe contains no trading logic. We also tested four different implementations of the actual indicator (draw once, closed bars only, stateless redraw, records with a redraw per bar). All of them work on 1H and 1D, and all of them fail on 4H.
- **Data availability on 4H as a higher timeframe:** The same indicator draws 4H zones correctly on a 1H chart, using `symbol({ timeframe: '240' })`.

**Assumption (not verified)**
During replay, the 4H chart may be built from lower-timeframe data. Script runs and drawing handles may not be managed the same way as on 1H and 1D.

**Attachments**
- `debug_engine_probe.js` (minimal reproduction script)
- Screenshots: probe on 4H, probe on 1H, indicator on 4H, and 4H zones on a 1H chart (working)

**Workaround for affected users**
View 4H levels on the 1H chart through a higher-timeframe series (`symbol({ timeframe: '240' })`).
