/**
 * QRS detection, dynamic gap-filling, ectopic beat search, and T-wave suppression
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { AnalysisError, T_GUARD_MAX_S, T_GUARD_SLOPE } from "./types";
import { ecgClean, gradient, median, percentile, uniformFilter1d } from "./dsp";

export function inAny(x: number, intervals: [number, number][]): boolean {
  for (let i = 0; i < intervals.length; i++) {
    const [a, b] = intervals[i];
    if (x >= a && x <= b) return true;
  }
  return false;
}

export function localMax(arr: Float64Array, i: number, half: number): number {
  const start = Math.max(0, i - half);
  const end = Math.min(arr.length, i + half + 1);
  let m = arr[start];
  for (let j = start + 1; j < end; j++) {
    if (arr[j] > m) m = arr[j];
  }
  return m;
}

/**
 * Align/snap to the maximum absolute deflection within ±50 ms (matching Python _snap)
 */
export function snap(i: number, clean: Float64Array, fs: number): number {
  const w = Math.floor(0.05 * fs);
  const a = Math.max(0, i - w);
  const b = Math.min(clean.length, i + w + 1);
  let bestIdx = a;
  let bestVal = Math.abs(clean[a]);
  for (let j = a + 1; j < b; j++) {
    const v = Math.abs(clean[j]);
    if (v > bestVal) {
      bestVal = v;
      bestIdx = j;
    }
  }
  return bestIdx;
}

/**
 * Finds local maxima and calculates prominence matching scipy.signal.find_peaks(data, prominence=(None, None))
 */
export function findProminentPeak(data: Float64Array): number | null {
  const peaks: number[] = [];
  const n = data.length;
  for (let i = 1; i < n - 1; i++) {
    if (data[i] > data[i - 1] && data[i] >= data[i + 1]) {
      if (data[i] === data[i + 1]) {
        let j = i + 1;
        while (j < n && data[j] === data[i]) j++;
        if (j < n && data[i] > data[j]) {
          peaks.push(i + Math.floor((j - 1 - i) / 2));
        }
      } else {
        peaks.push(i);
      }
    }
  }

  if (peaks.length === 0) return null;

  let bestPeak = peaks[0];
  let maxProminence = -Infinity;

  for (let k = 0; k < peaks.length; k++) {
    const p = peaks[k];
    const h = data[p];

    // Left base
    let l = p;
    while (l > 0 && data[l] <= h) l--;
    let leftBase = data[l];
    for (let idx = l + 1; idx <= p; idx++) {
      if (data[idx] < leftBase) leftBase = data[idx];
    }

    // Right base
    let r = p;
    while (r < n - 1 && data[r] <= h) r++;
    let rightBase = data[p];
    for (let idx = p + 1; idx <= r; idx++) {
      if (data[idx] < rightBase) rightBase = data[idx];
    }

    const base = Math.max(leftBase, rightBase);
    const prominence = h - base;
    if (prominence > maxProminence) {
      maxProminence = prominence;
      bestPeak = p;
    }
  }

  return bestPeak;
}

/**
 * NeuroKit2 QRS peak finder implementation
 */
export function findPeaksNeurokit(
  signal: Float64Array,
  fs: number,
  smoothWindow = 0.1,
  avgWindow = 0.75,
  gradThreshWeight = 1.5,
  minLenWeight = 0.4,
  minDelaySec = 0.3
): number[] {
  const grad = gradient(signal);
  const absGrad = new Float64Array(grad.length);
  for (let i = 0; i < grad.length; i++) absGrad[i] = Math.abs(grad[i]);

  const smoothKernel = Math.round(smoothWindow * fs);
  const avgKernel = Math.round(avgWindow * fs);
  const smoothGrad = uniformFilter1d(absGrad, smoothKernel);
  const avgGrad = uniformFilter1d(smoothGrad, avgKernel);

  const gradThreshold = new Float64Array(avgGrad.length);
  for (let i = 0; i < avgGrad.length; i++) {
    gradThreshold[i] = gradThreshWeight * avgGrad[i];
  }

  const minDelay = Math.round(fs * minDelaySec);

  // Identify start and end of QRS complexes
  const n = smoothGrad.length;
  const qrs = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (smoothGrad[i] > gradThreshold[i]) qrs[i] = 1;
  }

  const begQrs: number[] = [];
  const endQrs: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    if (qrs[i] === 0 && qrs[i + 1] === 1) begQrs.push(i);
    if (qrs[i] === 1 && qrs[i + 1] === 0) endQrs.push(i);
  }

  if (begQrs.length === 0) return [];

  // Throw out QRS ends that precede first QRS start
  const firstBeg = begQrs[0];
  const validEndQrs = endQrs.filter((e) => e > firstBeg);

  const numQrs = Math.min(begQrs.length, validEndQrs.length);
  if (numQrs === 0) return [];

  let sumLen = 0;
  for (let i = 0; i < numQrs; i++) {
    sumLen += validEndQrs[i] - begQrs[i];
  }
  const minLen = (sumLen / numQrs) * minLenWeight;

  const peaks: number[] = [0];

  for (let i = 0; i < numQrs; i++) {
    const beg = begQrs[i];
    const end = validEndQrs[i];
    const lenQrs = end - beg;
    if (lenQrs < minLen) continue;

    // Find local maxima and their prominence within QRS (matching scipy.signal.find_peaks)
    const data = signal.subarray(beg, end);
    const bestLocal = findProminentPeak(data);
    if (bestLocal !== null) {
      const peak = beg + bestLocal;
      if (peak - peaks[peaks.length - 1] > minDelay) {
        peaks.push(peak);
      }
    }
  }

  peaks.shift(); // Remove initial sentinel 0
  return peaks;
}

/**
 * Standard beat detection with 1-second constant extension padding
 */
export function cleanAndDetect(v: Float64Array, fs: number): { rawPeaks: number[]; clean: Float64Array } {
  const pad = fs;
  const n = v.length;
  const vv = new Float64Array(n + 2 * pad);
  vv.fill(v[0], 0, pad);
  vv.set(v, pad);
  vv.fill(v[n - 1], pad + n, vv.length);

  const cleanFull = ecgClean(vv, fs);
  const rawPeaksFull = findPeaksNeurokit(cleanFull, fs);

  const rawPeaks: number[] = [];
  for (let i = 0; i < rawPeaksFull.length; i++) {
    const p = rawPeaksFull[i] - pad;
    if (p >= 0 && p < n) {
      rawPeaks.push(p);
    }
  }

  const clean = cleanFull.subarray(pad, pad + n);
  return { rawPeaks, clean };
}

export interface DetectBeatsResult {
  beats: number[];
  sources: Record<number, string>;
  clean: Float64Array;
  slope: Float64Array;
}

/**
 * Multi-pass QRS detection matching detect_beats in apple_watch_ecg.py
 */
export function detectBeats(
  t: Float64Array,
  v: Float64Array,
  fs: number,
  removed: [number, number][]
): DetectBeatsResult {
  const { rawPeaks, clean } = cleanAndDetect(v, fs);

  const grad = gradient(clean);
  const slope = new Float64Array(grad.length);
  for (let i = 0; i < grad.length; i++) {
    slope[i] = Math.abs(grad[i]) * fs;
  }

  const cand: Map<number, string> = new Map();
  for (let i = 0; i < rawPeaks.length; i++) {
    const snapped = snap(rawPeaks[i], clean, fs);
    if (!cand.has(snapped)) {
      cand.set(snapped, "检测");
    }
  }

  if (cand.size < 3) {
    throw new AnalysisError("检测到的心搏少于 3 个，无法分析");
  }

  let keys = Array.from(cand.keys()).sort((a, b) => a - b);
  const half60 = Math.floor(0.06 * fs);

  const amps = keys.map((p) => Math.abs(clean[p]));
  const ampRef = median(amps);
  const slopes = keys.map((p) => localMax(slope, p, half60));
  const slopeRef = median(slopes);

  // 1. Dynamic gap-filling (补检)
  fillDynamicGaps(keys, cand, clean, slope, t, ampRef, slopeRef, half60, fs, removed);

  // 2. Large deflection search (大偏折)
  searchLargeDeflections(cand, clean, t, ampRef, fs, removed);

  // 3. Merge duplicate detections within 250 ms & prune weak candidates
  let beats = pruneAndMergeCandidates(cand, clean, slope, ampRef, slopeRef, half60, fs);

  // 4. Tall T-wave suppression (高大 T 波)
  beats = suppressTallTWaves(beats, slope, half60, fs);

  const sources: Record<number, string> = {};
  for (const b of beats) {
    sources[b] = cand.get(b) || "检测";
  }

  return { beats, sources, clean, slope };
}

/**
 * 1. Dynamic gap-filling (补检)
 * Checks for abnormally long RR intervals (> 1.5x local median) and searches for missed QRS.
 */
function fillDynamicGaps(
  b: number[],
  cand: Map<number, string>,
  clean: Float64Array,
  slope: Float64Array,
  t: Float64Array,
  ampRef: number,
  slopeRef: number,
  half60: number,
  fs: number,
  removed: [number, number][]
): void {
  const rr: number[] = [];
  for (let k = 0; k < b.length - 1; k++) {
    rr.push(b[k + 1] - b[k]);
  }

  for (let k = 0; k < rr.length; k++) {
    const slice = rr.slice(Math.max(0, k - 4), k + 5);
    const local = median(slice);
    if (rr[k] <= 1.5 * local) continue;

    const startGap = b[k] + Math.floor(0.25 * fs);
    const endGap = b[k + 1] - Math.floor(0.25 * fs);
    if (endGap - startGap < Math.floor(0.05 * fs)) continue;

    let bestI = startGap;
    let bestVal = Math.abs(clean[startGap]);
    for (let j = startGap + 1; j < endGap; j++) {
      const val = Math.abs(clean[j]);
      if (val > bestVal) {
        bestVal = val;
        bestI = j;
      }
    }

    if (inAny(t[bestI], removed)) continue;

    if (Math.abs(clean[bestI]) >= 0.4 * ampRef && localMax(slope, bestI, half60) >= 0.25 * slopeRef) {
      const snapped = snap(bestI, clean, fs);
      if (!cand.has(snapped)) {
        cand.set(snapped, "补检");
      }
    }
  }
}

/**
 * 2. Large deflection search (大偏折)
 * Discovers ectopic beats or ventricular premature contractions (PVCs) located outside refractory windows.
 */
function searchLargeDeflections(
  cand: Map<number, string>,
  clean: Float64Array,
  t: Float64Array,
  ampRef: number,
  fs: number,
  removed: [number, number][]
): void {
  const mask = new Uint8Array(clean.length);
  mask.fill(1);
  const pad20 = Math.floor(0.2 * fs);
  const pad35 = Math.floor(0.35 * fs);

  for (const p of cand.keys()) {
    const from = Math.max(0, p - pad20);
    const to = Math.min(clean.length, p + pad35 + 1);
    for (let j = from; j < to; j++) mask[j] = 0;
  }

  const bigIndices: number[] = [];
  const bigThresh = 1.5 * ampRef;
  for (let i = 0; i < clean.length; i++) {
    if (mask[i] === 1 && Math.abs(clean[i]) > bigThresh) {
      bigIndices.push(i);
    }
  }

  if (bigIndices.length === 0) return;

  const gapThresh = Math.floor(0.3 * fs);
  let curGroup: number[] = [bigIndices[0]];
  const groups: number[][] = [];

  for (let i = 1; i < bigIndices.length; i++) {
    if (bigIndices[i] - bigIndices[i - 1] > gapThresh) {
      groups.push(curGroup);
      curGroup = [bigIndices[i]];
    } else {
      curGroup.push(bigIndices[i]);
    }
  }
  groups.push(curGroup);

  for (const g of groups) {
    let bestG = g[0];
    let bestV = Math.abs(clean[g[0]]);
    for (let j = 1; j < g.length; j++) {
      const vVal = Math.abs(clean[g[j]]);
      if (vVal > bestV) {
        bestV = vVal;
        bestG = g[j];
      }
    }
    if (!inAny(t[bestG], removed)) {
      const snapped = snap(bestG, clean, fs);
      if (!cand.has(snapped)) {
        cand.set(snapped, "大偏折");
      }
    }
  }
}

/**
 * 3. Merge duplicate detections within 250 ms & prune weak candidates
 */
function pruneAndMergeCandidates(
  cand: Map<number, string>,
  clean: Float64Array,
  slope: Float64Array,
  ampRef: number,
  slopeRef: number,
  half60: number,
  fs: number
): number[] {
  const allCand = Array.from(cand.keys()).sort((a, b) => a - b);
  const min250 = Math.floor(0.25 * fs);
  const beats: number[] = [];

  for (let i = 0; i < allCand.length; i++) {
    const p = allCand[i];
    const s = localMax(slope, p, half60);
    const a = Math.abs(clean[p]);

    if (s < 0.25 * slopeRef && a < 0.6 * ampRef) {
      continue;
    }

    if (beats.length > 0 && p - beats[beats.length - 1] < min250) {
      if (s > localMax(slope, beats[beats.length - 1], half60)) {
        beats[beats.length - 1] = p;
      }
      continue;
    }
    beats.push(p);
  }

  return beats;
}

/**
 * 4. Tall T-wave suppression (高大 T 波)
 * Suppresses sharp peaked T-waves incorrectly detected as premature beats.
 */
function suppressTallTWaves(
  beats: number[],
  slope: Float64Array,
  half60: number,
  fs: number
): number[] {
  if (beats.length < 5) return beats;

  const sl = beats.map((p) => localMax(slope, p, half60));
  const p75 = percentile(sl, 75);
  const strongCut = 0.5 * p75;
  const strongBeats: number[] = [];
  for (let i = 0; i < beats.length; i++) {
    if (sl[i] >= strongCut) strongBeats.push(beats[i]);
  }

  let rrRef: number | null = null;
  if (strongBeats.length >= 3) {
    const strongDiffs: number[] = [];
    for (let i = 0; i < strongBeats.length - 1; i++) {
      strongDiffs.push(strongBeats[i + 1] - strongBeats[i]);
    }
    rrRef = median(strongDiffs);
  }

  const keep = new Array(beats.length).fill(true);
  const tGuardSamples = Math.floor(T_GUARD_MAX_S * fs);

  if (rrRef !== null) {
    for (let i = 1; i < beats.length - 1; i++) {
      if (!keep[i - 1]) continue;
      const gap = beats[i + 1] - beats[i - 1];
      if (
        beats[i] - beats[i - 1] < tGuardSamples &&
        sl[i] < T_GUARD_SLOPE * sl[i - 1] &&
        Math.abs(gap - rrRef) <= 0.2 * rrRef
      ) {
        keep[i] = false;
      }
    }
  }

  // Boundary beats
  if (beats[0] < tGuardSamples && sl[0] < T_GUARD_SLOPE * sl[1]) {
    keep[0] = false;
  }
  if (
    beats[beats.length - 1] - beats[beats.length - 2] < tGuardSamples &&
    sl[beats.length - 1] < T_GUARD_SLOPE * sl[beats.length - 2] &&
    keep[beats.length - 2]
  ) {
    keep[beats.length - 1] = false;
  }

  return beats.filter((_, idx) => keep[idx]);
}

