/**
 * Vector ECG grid strip clustering, calibration square pulse, and row signal extraction
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { PT_PER_MM, Row, STRIP_SECONDS, WatchInfo } from "../types";
import { interp, median, sampleGrid } from "../dsp";
import { GridStrip, LineSegment, PaintedPath, Point2D } from "./types";
import { isGray, isRed } from "./graphics";

/**
 * Clusters light gray grid lines (0.75 <= gray <= 0.95) into distinct waveform strips.
 */
export function findGridStrips(paintedPaths: PaintedPath[]): GridStrip[] {
  const allGraySegs: LineSegment[] = [];
  for (const p of paintedPaths) {
    if (isGray(p.color, 0.75, 0.95)) {
      allGraySegs.push(...p.segs);
    }
  }

  if (allGraySegs.length === 0) return [];

  const ys: number[] = [];
  for (const s of allGraySegs) {
    ys.push(s.p1.y, s.p2.y);
  }
  ys.sort((a, b) => a - b);

  const cuts: number[] = [];
  for (let i = 0; i < ys.length - 1; i++) {
    if (ys[i + 1] - ys[i] > 5.0) {
      cuts.push(i);
    }
  }

  let prevCut = 0;
  const strips: GridStrip[] = [];
  for (let k = 0; k <= cuts.length; k++) {
    const cutIdx = k < cuts.length ? cuts[k] + 1 : ys.length;
    const b = ys.slice(prevCut, cutIdx);
    prevCut = cutIdx;
    if (b.length === 0) continue;

    const y0 = Math.min(...b);
    const y1 = Math.max(...b);

    const matching = allGraySegs.filter(
      (s) =>
        Math.min(s.p1.y, s.p2.y) >= y0 - 0.1 &&
        Math.max(s.p1.y, s.p2.y) <= y1 + 0.1,
    );
    if (matching.length === 0) continue;

    const x0 = Math.min(...matching.map((s) => Math.min(s.p1.x, s.p2.x)));
    const x1 = Math.max(...matching.map((s) => Math.max(s.p1.x, s.p2.x)));

    if (y1 - y0 > 20 && x1 - x0 > 200) {
      strips.push({ x0, y0, x1, y1 });
    }
  }

  return strips.sort((a, b) => a.y0 - b.y0);
}

/**
 * Finds the dark gray calibration pulse (1 mV) on the left of the first strip.
 */
export function findCalPulseHeight(
  paintedPaths: PaintedPath[],
  strip: GridStrip,
): number | null {
  for (const p of paintedPaths) {
    if (isGray(p.color, 0, 0.6)) {
      const allY = p.segs.flatMap((s) => [s.p1.y, s.p2.y]);
      const allX = p.segs.flatMap((s) => [s.p1.x, s.p2.x]);
      if (allY.length > 0) {
        const h = Math.max(...allY) - Math.min(...allY);
        const w = Math.max(...allX) - Math.min(...allX);
        const x0 = Math.min(...allX);
        const y0 = Math.min(...allY);
        const y1 = Math.max(...allY);
        if (
          y0 >= strip.y0 - 1 &&
          y1 <= strip.y1 + 1 &&
          x0 <= strip.x0 + 5 &&
          w < 60 &&
          h > 10 &&
          h < 60
        ) {
          return h;
        }
      }
    }
  }
  return null;
}

/**
 * Extracts, resamples, and normalizes rows of continuous vector ECG signal.
 */
export function extractVectorRows(
  paintedPaths: PaintedPath[],
  strips: GridStrip[],
  watch: WatchInfo,
  fs: number,
): { rows: Row[]; ptPerMv: number; notes: string[] } {
  const notes: string[] = [];
  const ptPerS = watch.paper_speed_mm_s * PT_PER_MM;
  const cal =
    strips.length > 0 ? findCalPulseHeight(paintedPaths, strips[0]) : null;
  const expect = watch.gain_mm_mv * PT_PER_MM;
  const ptPerMv = cal ? cal : expect;

  if (cal && Math.abs(cal - expect) / expect > 0.03) {
    notes.push(
      `定标方波高度 ${cal.toFixed(1)} pt 与增益 ${watch.gain_mm_mv} mm/mV 不一致，已按定标方波换算`,
    );
  }
  if (!cal) {
    notes.push("未找到定标方波，电压按 PDF 标注的增益换算");
  }

  const redPaths = paintedPaths.filter((p) => isRed(p.color));
  const rows: Row[] = [];

  for (let i = 0; i < strips.length; i++) {
    const s = strips[i];
    const stripDur = (s.x1 - s.x0) / ptPerS;

    if (Math.abs(stripDur - STRIP_SECONDS) > 0.2) {
      notes.push(
        `第 ${i + 1} 行网格宽度换算为 ${stripDur.toFixed(2)} 秒（预期 10 秒），请核对纸速`,
      );
    }

    const stripPoints: Point2D[] = [];
    for (const rp of redPaths) {
      const yy = rp.points.map((p) => p.y);
      const center = (Math.min(...yy) + Math.max(...yy)) / 2;
      if (s.y0 - 2 <= center && center <= s.y1 + 2 && rp.segs.length >= 4)
        stripPoints.push(...rp.points);
    }

    if (stripPoints.length < 50) continue;

    // Match NumPy unique: stable x sort and first duplicate, keeping drawing order.
    stripPoints.sort((a, b) => a.x - b.x);
    const uniquePoints = stripPoints.filter(
      (p, j) => j === 0 || p.x !== stripPoints[j - 1].x,
    );

    const xs = uniquePoints.map((p) => p.x);
    const ysTrace = uniquePoints.map((p) => p.y);

    const tAbs = xs.map((x) => i * stripDur + (x - s.x0) / ptPerS);
    const tStart = tAbs[0];
    const tEnd = tAbs[tAbs.length - 1];
    const tGrid = sampleGrid(tStart, tEnd, fs);

    const yInterp = interp(tGrid, tAbs, ysTrace);
    const yMed = median(yInterp);

    const vRow = new Float64Array(yInterp.length);
    const clipRow = new Uint8Array(yInterp.length);

    for (let c = 0; c < yInterp.length; c++) {
      // Invert voltage because PDF y increases downwards
      vRow[c] = -(yInterp[c] - yMed) / ptPerMv;
      clipRow[c] = yInterp[c] >= s.y1 - 0.6 || yInterp[c] <= s.y0 + 0.6 ? 1 : 0;
    }

    rows.push({
      index: i,
      t: tGrid,
      v: vRow,
      clip: clipRow,
    });
  }

  return { rows, ptPerMv, notes };
}
