/**
 * Baseline estimation and artifact window detection
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ARTIFACT_MV } from "./types";
import { median, medianFilter, ptp } from "./dsp";

export function toOdd(n: number): number {
  const rounded = Math.max(5, Math.floor(n));
  return rounded % 2 === 1 ? rounded : rounded + 1;
}

/**
 * Two-stage median filter (0.2 s removes QRS, 0.6 s removes P/T waves) to estimate baseline.
 */
export function estimateBaseline(v: Float64Array, fs: number): Float64Array {
  const size1 = toOdd(0.2 * fs);
  const size2 = toOdd(0.6 * fs);
  const b = medianFilter(v, size1);
  return medianFilter(b, size2);
}

/**
 * Baseline artifact detection:
 * Any 1-second window where baseline peak-to-peak exceeds ARTIFACT_MV (0.5 mV).
 * Sliding step is 0.25 s (fs / 4).
 * Spans are merged, shrunk to segments deviating > ARTIFACT_MV / 2, with 0.2 s padding on both sides.
 */
export function detectArtifactWindows(
  t: Float64Array,
  v: Float64Array,
  fs: number,
  baseInput?: Float64Array,
): [number, number][] {
  const base = baseInput ?? estimateBaseline(v, fs);
  const win = fs;
  const step = Math.max(1, Math.floor(fs / 4));
  const spans: [number, number][] = [];

  for (let s = 0; s < Math.max(1, base.length - win + 1); s += step) {
    const slice = base.subarray(s, s + win);
    if (ptp(slice) > ARTIFACT_MV) {
      const e = Math.min(s + win, base.length - 1);
      if (spans.length > 0 && s <= spans[spans.length - 1][1]) {
        spans[spans.length - 1][1] = e;
      } else {
        spans.push([s, e]);
      }
    }
  }

  const ref = median(base);
  const out: [number, number][] = [];

  for (const [startSpan, endSpan] of spans) {
    let s = startSpan;
    let e = endSpan;

    // Find indices within [s, e] where |base[i] - ref| > ARTIFACT_MV / 2
    let firstDev = -1;
    let lastDev = -1;
    const halfThresh = ARTIFACT_MV / 2;

    for (let i = s; i <= e; i++) {
      if (Math.abs(base[i] - ref) > halfThresh) {
        if (firstDev === -1) firstDev = i;
        lastDev = i;
      }
    }

    if (firstDev !== -1) {
      s = firstDev;
      e = lastDev;
    }

    const padSamples = Math.floor(0.2 * fs);
    const a = t[Math.max(0, s - padSamples)];
    const b = t[Math.min(t.length - 1, e + padSamples)];

    if (out.length > 0 && a <= out[out.length - 1][1]) {
      out[out.length - 1][1] = Math.max(out[out.length - 1][1], b);
    } else {
      out.push([a, b]);
    }
  }

  return out;
}
