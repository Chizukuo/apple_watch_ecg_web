/**
 * Morphology analysis, fiducial delineation, and dual-baseline measurements
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { AnalysisError, MorphologyResult, ODD_QRS_CORR } from "./types";
import { corr, gradient, maximumFilter1d, median, savgolFilter } from "./dsp";
import { estimateBaseline, toOdd } from "./baseline";

/**
 * Determine QRS onset and J-point (matching Python _qrs_bounds)
 */
export function qrsBounds(
  sm: Float64Array,
  center: number,
  fs: number,
  extend = false
): [number, number] {
  const grad = gradient(sm);
  const d = new Float64Array(grad.length);
  for (let i = 0; i < grad.length; i++) d[i] = Math.abs(grad[i]) * fs;

  const qa = Math.max(1, center - Math.floor(0.08 * fs));
  const qb = Math.min(sm.length - 2, center + Math.floor(0.1 * fs));

  let dmax = 0;
  for (let i = qa; i < qb; i++) {
    if (d[i] > dmax) dmax = d[i];
  }

  if (dmax <= 0) {
    return [center, center];
  }

  const thr = 0.1 * dmax;
  const envSize = Math.max(3, Math.floor(0.018 * fs));
  const env = maximumFilter1d(d, envSize);

  // Find steep region
  let firstSteep = -1;
  let lastSteep = -1;
  const halfDmax = 0.5 * dmax;
  for (let i = qa; i < qb; i++) {
    if (d[i] > halfDmax) {
      if (firstSteep === -1) firstSteep = i;
      lastSteep = i;
    }
  }

  if (firstSteep === -1) {
    return [center, center];
  }

  let on = firstSteep;
  let J = lastSteep;
  const lo = Math.max(1, qa - Math.floor(0.06 * fs));
  const hi = Math.min(sm.length - 2, qb + Math.floor(0.06 * fs));

  while (on > lo && env[on - 1] > thr) {
    on--;
  }
  while (d[on] <= thr && on < firstSteep) {
    on++;
  }
  while (J < hi && env[J + 1] > thr) {
    J++;
  }
  while (d[J] <= thr && J > lastSteep) {
    J--;
  }

  if (!extend) {
    return [on, J];
  }

  // Extend for slow initial or terminal waves
  let p2p = 0;
  let minVal = sm[on];
  let maxVal = sm[on];
  for (let i = on + 1; i <= J; i++) {
    if (sm[i] < minVal) minVal = sm[i];
    if (sm[i] > maxVal) maxVal = sm[i];
  }
  p2p = maxVal - minVal;

  const look = Math.floor(0.06 * fs);

  // Extend terminal side (S/J)
  for (let rep = 0; rep < 2; rep++) {
    const a = J + 1;
    const b = Math.min(sm.length - 2, J + look, hi);
    if (b <= a) break;

    let k = a;
    let maxD = d[a];
    for (let i = a + 1; i < b; i++) {
      if (d[i] > maxD) {
        maxD = d[i];
        k = i;
      }
    }

    let e = k;
    while (e < hi && env[e + 1] > thr) {
      e++;
    }

    if (d[k] < 0.15 * dmax || Math.abs(sm[e] - sm[J]) < 0.2 * p2p) {
      break;
    }
    J = e;
    while (d[J] <= thr && J > k) {
      J--;
    }
  }

  // Extend onset side (Q)
  for (let rep = 0; rep < 2; rep++) {
    const a = Math.max(1, on - look, lo);
    const b = on - 1;
    if (b <= a) break;

    let k = a;
    let maxD = d[a];
    for (let i = a + 1; i <= b; i++) {
      if (d[i] > maxD) {
        maxD = d[i];
        k = i;
      }
    }

    let s = k;
    while (s > lo && env[s - 1] > thr) {
      s--;
    }

    if (d[k] < 0.15 * dmax || Math.abs(sm[on] - sm[s]) < 0.2 * p2p) {
      break;
    }
    on = s;
    while (d[on] <= thr && on < k) {
      on++;
    }
  }

  return [on, J];
}

/**
 * Tangent method for T-wave end (matching Python _tangent_tend)
 */
export function tangentTend(
  sm: Float64Array,
  d: Float64Array,
  tpk: number,
  base: number,
  fs: number,
  sign: number
): number | null {
  const len = Math.floor(0.18 * fs);
  const end = Math.min(sm.length, tpk + len);
  if (end - tpk < 3) return null;

  let minK = tpk;
  let minVal = sign * d[tpk];
  for (let i = tpk + 1; i < end; i++) {
    const val = sign * d[i];
    if (val < minVal) {
      minVal = val;
      minK = i;
    }
  }

  const slopeAtK = d[minK];
  if (slopeAtK === 0) return null;

  return minK + (base - sm[minK]) / (slopeAtK / fs);
}

export interface BeatMorphologyOutput {
  pos: number[];
  cq: (number | null)[];
  cqt: (number | null)[];
  widths: (number | null)[];
  width_t: number;
}

/**
 * Multi-beat alignment and morphology comparison (matching Python beat_morphology)
 */
export function beatMorphology(
  v: Float64Array,
  beats: number[],
  fs: number,
  removedFlags: boolean[],
  baseInput?: Float64Array
): BeatMorphologyOutput {
  const vRaw = v;
  const win = toOdd(0.029 * fs);
  const baseLine = baseInput ?? estimateBaseline(v, fs);

  const vSub = new Float64Array(v.length);
  for (let i = 0; i < v.length; i++) vSub[i] = v[i] - baseLine[i];
  const vSmooth = savgolFilter(vSub, win, 3);

  const A = Math.floor(0.25 * fs);
  const B = Math.floor(0.45 * fs);
  const qa = Math.floor(0.1 * fs);
  const qb = Math.floor(0.12 * fs);
  const lag = Math.floor(0.05 * fs);

  function isFull(idx: number): boolean {
    return idx - A >= 0 && idx + B <= vSmooth.length;
  }

  function buildTemplate(indices: number[]): Float64Array | null {
    const segs: Float64Array[] = [];
    for (const idx of indices) {
      if (isFull(idx)) {
        segs.push(vSmooth.subarray(idx - A, idx + B));
      }
    }
    if (segs.length < 3) return null;

    const len = A + B;
    const tmpl = new Float64Array(len);
    const col = new Float64Array(segs.length);
    for (let c = 0; c < len; c++) {
      for (let r = 0; r < segs.length; r++) {
        col[r] = segs[r][c];
      }
      tmpl[c] = median(col);
    }
    return tmpl;
  }

  function alignBeat(i: number, tmpl: Float64Array): [number, number | null] {
    let bestCorr = -2.0;
    let bestIdx = i;
    const tq = tmpl.subarray(A - qa, A + qb);

    for (let s = -lag; s <= lag; s++) {
      const j = i + s;
      if (j - qa < 0 || j + qb > vSmooth.length) continue;
      const c = corr(vSmooth.subarray(j - qa, j + qb), tq);
      if (c > bestCorr) {
        bestCorr = c;
        bestIdx = j;
      }
    }

    if (bestCorr >= ODD_QRS_CORR) {
      return [bestIdx, bestCorr];
    }
    if (i - qa >= 0 && i + qb <= vSmooth.length) {
      return [i, corr(vSmooth.subarray(i - qa, i + qb), tq)];
    }
    return [i, null];
  }

  const baseIdx = beats.filter((_, idx) => !removedFlags[idx]);
  let tmpl = baseIdx.length >= 3 ? buildTemplate(baseIdx) : null;
  if (!tmpl) tmpl = buildTemplate(beats);
  if (!tmpl) {
    throw new AnalysisError("完整的心搏少于 3 个，无法建立主导形态");
  }

  let aligned = beats.map((b) => alignBeat(b, tmpl!));
  let pos = aligned.map((a) => a[0]);
  let cq = aligned.map((a) => a[1]);

  // Second pass template refinement
  const good = pos.filter((_, idx) => cq[idx] !== null && cq[idx]! >= 0.9 && !removedFlags[idx]);
  const tmpl2 = buildTemplate(good);
  if (tmpl2) {
    tmpl = tmpl2;
    aligned = beats.map((b) => alignBeat(b, tmpl!));
    pos = aligned.map((a) => a[0]);
    cq = aligned.map((a) => a[1]);
  }

  const cqt: (number | null)[] = [];
  const widths: (number | null)[] = [];

  for (let k = 0; k < pos.length; k++) {
    const p = pos[k];
    const nxt = k + 1 < pos.length ? pos[k + 1] - p : B;
    let L = Math.max(qb, Math.min(B, Math.floor(0.85 * nxt)));

    if (cq[k] === null) {
      cqt.push(null);
    } else {
      L = Math.min(L, vSmooth.length - p);
      cqt.push(corr(vSmooth.subarray(p - qa, p + L), tmpl.subarray(A - qa, A + L)));
    }

    const a1 = Math.min(A, p);
    const b1 = Math.min(B, vSmooth.length - p);
    const segRaw = vRaw.subarray(p - a1, p + b1);

    if (segRaw.length >= win + 2 && a1 >= Math.floor(0.1 * fs) && b1 >= Math.floor(0.18 * fs)) {
      const segSm = savgolFilter(new Float64Array(segRaw), win, 3);
      const [on, J] = qrsBounds(segSm, a1, fs, false);
      widths.push(((J - on) / fs) * 1000);
    } else {
      widths.push(null);
    }
  }

  let refWidths = widths.filter(
    (w, idx) => w !== null && cq[idx] !== null && cq[idx]! >= 0.9 && !removedFlags[idx]
  ) as number[];

  if (refWidths.length < 3) {
    refWidths = widths.filter((w) => w !== null) as number[];
  }
  const width_t = refWidths.length > 0 ? median(refWidths) : 0.0;

  return { pos, cq, cqt, widths, width_t };
}

/**
 * Measure P, PR, QRS, ST, T, QT on median template with TP vs PQ dual baseline
 */
export function measureTemplate(
  W: Float64Array[],
  pre: number,
  rrMean: number,
  fs: number
): MorphologyResult {
  const win = toOdd(0.029 * fs);
  const nBeats = W.length;
  const len = W[0].length;

  const b0 = pre - Math.floor(Math.min(0.3, 0.45 * rrMean) * fs);
  const b1 = pre - Math.floor(Math.min(0.21, 0.32 * rrMean) * fs);

  // 1. Subtract per-beat TP baseline
  const W_norm = normalizeTpBaseline(W, b0, b1);

  // 2. Median template across beats
  const tm = computeColumnMedians(W_norm, len);
  const sm = savgolFilter(tm, win, 3);
  const grad = gradient(sm);
  const d = new Float64Array(grad.length);
  for (let i = 0; i < grad.length; i++) d[i] = grad[i] * fs;

  let baseTpSum = 0;
  for (let c = b0; c < b1; c++) baseTpSum += sm[c];
  const base_tp = baseTpSum / (b1 - b0);

  // 3. QRS bounds & PQ baseline
  const [on, J] = qrsBounds(sm, pre, fs, true);
  const q0 = on - Math.floor(0.04 * fs);
  const q1 = on - Math.floor(0.015 * fs);
  let basePqSum = 0;
  for (let c = q0; c < q1; c++) basePqSum += sm[c];
  const base = basePqSum / Math.max(1, q1 - q0);

  // 4. R & S peak detection and amplitudes
  const { R, S, r_amp, s_amp } = measureQrsAmplitudes(sm, W_norm, on, J, nBeats);

  // 5. T-wave & QT measurement
  const { Tpk, Tend, t_sign, qt, qtsList } = measureTWave(
    sm, d, base, J, pre, rrMean, fs, nBeats, W_norm, on, q0, q1, win
  );

  // 6. P-wave & PR measurement
  const { P, p_amp, p_pol, p_ok, pr } = measurePWave(
    sm, base_tp, on, rrMean, fs, nBeats, W_norm, tm
  );

  // 7. Full template noise estimation
  let fullNoiseSum = 0;
  const totalPoints = nBeats * len;
  for (let r = 0; r < nBeats; r++) {
    for (let c = 0; c < len; c++) {
      const diff = W_norm[r][c] - tm[c];
      fullNoiseSum += diff * diff;
    }
  }
  const noise = Math.sqrt(fullNoiseSum / Math.max(1, totalPoints));

  const j60Idx = Math.min(J + Math.floor(0.06 * fs), sm.length - 1);

  return {
    tm,
    sm,
    base,
    on,
    J,
    R,
    S,
    Tpk,
    Tend,
    P,
    p_amp,
    p_pol: p_ok ? p_pol : null,
    p_ok,
    pr,
    qrs: ((J - on) / fs) * 1000,
    r_amp,
    s_amp,
    st_j: sm[J] - base,
    st_j60: sm[j60Idx] - base,
    t_amp: Tpk !== null ? sm[Tpk] - base : null,
    t_pol: Tpk !== null ? (t_sign > 0 ? "直立" : "倒置") : null,
    qt,
    qts: new Float64Array(qtsList),
    noise,
    n: nBeats,
    W: W_norm,
  };
}

function normalizeTpBaseline(W: Float64Array[], b0: number, b1: number): Float64Array[] {
  const nBeats = W.length;
  const len = W[0].length;
  const W_norm: Float64Array[] = [];
  for (let r = 0; r < nBeats; r++) {
    let tpSum = 0;
    for (let c = b0; c < b1; c++) tpSum += W[r][c];
    const tpMean = tpSum / (b1 - b0);
    const row = new Float64Array(len);
    for (let c = 0; c < len; c++) row[c] = W[r][c] - tpMean;
    W_norm.push(row);
  }
  return W_norm;
}

function computeColumnMedians(matrix: Float64Array[], len: number): Float64Array {
  const nRows = matrix.length;
  const out = new Float64Array(len);
  const col = new Float64Array(nRows);
  for (let c = 0; c < len; c++) {
    for (let r = 0; r < nRows; r++) col[r] = matrix[r][c];
    out[c] = median(col);
  }
  return out;
}

function measureQrsAmplitudes(
  sm: Float64Array,
  W_norm: Float64Array[],
  on: number,
  J: number,
  nBeats: number
): { R: number; S: number; r_amp: number; s_amp: number } {
  let R = on;
  let maxR = sm[on];
  for (let i = on + 1; i <= J; i++) {
    if (sm[i] > maxR) {
      maxR = sm[i];
      R = i;
    }
  }

  let S = R;
  let minS = sm[R];
  for (let i = R + 1; i <= J; i++) {
    if (sm[i] < minS) {
      minS = sm[i];
      S = i;
    }
  }

  const rAmps = new Float64Array(nBeats);
  const sAmps = new Float64Array(nBeats);
  for (let r = 0; r < nBeats; r++) {
    let rMax = W_norm[r][on];
    for (let c = on + 1; c <= J; c++) {
      if (W_norm[r][c] > rMax) rMax = W_norm[r][c];
    }
    rAmps[r] = rMax;

    let sMin = W_norm[r][R];
    for (let c = R + 1; c <= J; c++) {
      if (W_norm[r][c] < sMin) sMin = W_norm[r][c];
    }
    sAmps[r] = sMin;
  }

  return {
    R,
    S,
    r_amp: median(rAmps),
    s_amp: median(sAmps),
  };
}

function measureTWave(
  sm: Float64Array,
  d: Float64Array,
  base: number,
  J: number,
  pre: number,
  rrMean: number,
  fs: number,
  nBeats: number,
  W_norm: Float64Array[],
  on: number,
  q0: number,
  q1: number,
  win: number
): { Tpk: number | null; Tend: number | null; t_sign: number; qt: number | null; qtsList: number[] } {
  const ta = J + Math.floor(0.06 * fs);
  const tb = Math.min(
    pre + Math.floor(0.45 * fs),
    pre + Math.floor(0.7 * rrMean * fs),
    sm.length - Math.floor(0.2 * fs)
  );

  let Tpk: number | null = null;
  let Tend: number | null = null;
  let t_sign = 1;
  const qtsList: number[] = [];

  if (tb > ta + Math.floor(0.02 * fs)) {
    let maxDev = Math.abs(sm[ta] - base);
    Tpk = ta;
    for (let i = ta + 1; i < tb; i++) {
      const dev = Math.abs(sm[i] - base);
      if (dev > maxDev) {
        maxDev = dev;
        Tpk = i;
      }
    }

    t_sign = sm[Tpk] >= base ? 1 : -1;
    Tend = tangentTend(sm, d, Tpk, base, fs, t_sign);

    for (let r = 0; r < nBeats; r++) {
      const s2 = savgolFilter(W_norm[r], win, 3);
      const grad2 = gradient(s2);
      const d2 = new Float64Array(grad2.length);
      for (let i = 0; i < grad2.length; i++) d2[i] = grad2[i] * fs;

      let b2Sum = 0;
      for (let c = q0; c < q1; c++) b2Sum += s2[c];
      const b2 = b2Sum / Math.max(1, q1 - q0);

      let tp2 = ta;
      let dev2 = Math.abs(s2[ta] - b2);
      for (let i = ta + 1; i < tb; i++) {
        const vDev = Math.abs(s2[i] - b2);
        if (vDev > dev2) {
          dev2 = vDev;
          tp2 = i;
        }
      }

      const te2 = tangentTend(s2, d2, tp2, b2, fs, t_sign);
      if (te2 !== null) {
        qtsList.push(((te2 - on) / fs) * 1000);
      }
    }
  }

  const qt = Tend !== null ? ((Tend - on) / fs) * 1000 : null;
  return { Tpk, Tend, t_sign, qt, qtsList };
}

function measurePWave(
  sm: Float64Array,
  base_tp: number,
  on: number,
  rrMean: number,
  fs: number,
  nBeats: number,
  W_norm: Float64Array[],
  tm: Float64Array
): {
  P: number | null;
  p_amp: number;
  p_pol: "直立" | "倒置" | null;
  p_ok: boolean;
  pr: number | null;
} {
  const pa = on - Math.floor(Math.min(0.25, 0.35 * rrMean) * fs);
  const pb = on - Math.floor(0.06 * fs);

  let P: number | null = null;
  let p_amp = 0.0;
  let p_pol: "直立" | "倒置" | null = null;
  let p_ok = false;
  let pr: number | null = null;

  if (pb > pa + 5) {
    let maxPos = sm[pa] - base_tp;
    let maxPosIdx = pa;
    let minNeg = sm[pa] - base_tp;
    let minNegIdx = pa;

    for (let i = pa + 1; i < pb; i++) {
      const val = sm[i] - base_tp;
      if (val > maxPos) {
        maxPos = val;
        maxPosIdx = i;
      }
      if (val < minNeg) {
        minNeg = val;
        minNegIdx = i;
      }
    }

    if (maxPos >= -minNeg) {
      P = maxPosIdx;
      p_amp = maxPos;
      p_pol = "直立";
    } else {
      P = minNegIdx;
      p_amp = minNeg;
      p_pol = "倒置";
    }

    let noiseSqSum = 0;
    let countP = 0;
    for (let r = 0; r < nBeats; r++) {
      for (let c = pa; c < pb; c++) {
        const diff = W_norm[r][c] - tm[c];
        noiseSqSum += diff * diff;
        countP++;
      }
    }
    const noise_p = Math.sqrt(noiseSqSum / Math.max(1, countP));
    p_ok = Math.abs(p_amp) > Math.max(0.025, (3 * 1.25 * noise_p) / Math.sqrt(nBeats));

    if (p_ok) {
      let po = P;
      const poMin = pa - Math.floor(0.05 * fs);
      const pThresh = 0.15 * Math.abs(p_amp);
      while (po > poMin && Math.abs(sm[po] - base_tp) > pThresh) {
        po--;
      }
      pr = ((on - po) / fs) * 1000;
    }
  }

  return { P, p_amp, p_pol, p_ok, pr };
}

