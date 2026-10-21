/**
 * Digital Signal Processing & Numerical Utilities
 * Precision TypeScript port of NumPy/SciPy/NeuroKit2 functions used in apple_watch_ecg
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export function mean(arr: ArrayLike<number>): number {
  if (arr.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < arr.length; i++) sum += arr[i];
  return sum / arr.length;
}

export function median(arr: ArrayLike<number>): number {
  if (arr.length === 0) return 0;
  const sorted = Array.from(arr).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid];
  }
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

export function percentile(arr: ArrayLike<number>, p: number): number {
  if (arr.length === 0) return 0;
  const sorted = Array.from(arr).sort((a, b) => a - b);
  if (p <= 0) return sorted[0];
  if (p >= 100) return sorted[sorted.length - 1];
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const frac = idx - lo;
  return sorted[lo] + (sorted[hi] - sorted[lo]) * frac;
}

export function ptp(arr: ArrayLike<number>): number {
  if (arr.length === 0) return 0;
  let min = arr[0];
  let max = arr[0];
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] < min) min = arr[i];
    if (arr[i] > max) max = arr[i];
  }
  return max - min;
}

export function var_(arr: ArrayLike<number>, ddof = 0): number {
  const n = arr.length;
  if (n <= ddof) return 0;
  const m = mean(arr);
  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    const diff = arr[i] - m;
    sumSq += diff * diff;
  }
  return sumSq / (n - ddof);
}

export function std(arr: ArrayLike<number>, ddof = 0): number {
  return Math.sqrt(var_(arr, ddof));
}

/**
 * 1D linear interpolation matching np.interp(x, xp, fp)
 * xp must be monotonically increasing.
 */
export function interp(
  x: Float64Array | number[],
  xp: Float64Array | number[],
  fp: Float64Array | number[],
): Float64Array {
  const n = x.length;
  const m = xp.length;
  const out = new Float64Array(n);
  if (m === 0) return out;
  if (m === 1) {
    out.fill(fp[0]);
    return out;
  }

  let j = 0;
  for (let i = 0; i < n; i++) {
    const xi = x[i];
    if (xi <= xp[0]) {
      out[i] = fp[0];
      continue;
    }
    if (xi >= xp[m - 1]) {
      out[i] = fp[m - 1];
      continue;
    }
    while (j < m - 1 && xp[j + 1] < xi) {
      j++;
    }
    const x0 = xp[j];
    const x1 = xp[j + 1];
    const f0 = fp[j];
    const f1 = fp[j + 1];
    out[i] = f0 + ((xi - x0) / (x1 - x0)) * (f1 - f0);
  }
  return out;
}

/**
 * Central differences matching np.gradient
 */
export function gradient(arr: Float64Array): Float64Array {
  const n = arr.length;
  const g = new Float64Array(n);
  if (n <= 1) return g;
  g[0] = arr[1] - arr[0];
  for (let i = 1; i < n - 1; i++) {
    g[i] = (arr[i + 1] - arr[i - 1]) / 2;
  }
  g[n - 1] = arr[n - 1] - arr[n - 2];
  return g;
}

/**
 * Linear detrend matching scipy.signal.detrend
 */
export function detrend(arr: Float64Array): Float64Array {
  const n = arr.length;
  if (n <= 1) return new Float64Array(arr);
  let sumY = 0;
  let sumXY = 0;
  const mid = (n - 1) / 2;
  let sumX2 = 0;

  for (let i = 0; i < n; i++) {
    const x = i - mid;
    const y = arr[i];
    sumY += y;
    sumXY += x * y;
    sumX2 += x * x;
  }

  const slope = sumX2 === 0 ? 0 : sumXY / sumX2;
  const intercept = sumY / n;

  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const x = i - mid;
    out[i] = arr[i] - (intercept + slope * x);
  }
  return out;
}

/**
 * Pearson correlation coefficient of detrended signals (matching Python _corr)
 */
export function corr(a: Float64Array, b: Float64Array): number {
  if (a.length < 8 || a.length !== b.length) return 0.0;
  const da = detrend(a);
  const db = detrend(b);
  const sa = std(da);
  const sb = std(db);
  if (sa === 0 || sb === 0) return 0.0;
  let sumProd = 0;
  for (let i = 0; i < da.length; i++) {
    sumProd += da[i] * db[i];
  }
  return sumProd / da.length / (sa * sb);
}

/**
 * 1D median filter with 'nearest' boundary mode matching scipy.ndimage.median_filter(v, size, mode="nearest")
 * Sorted sliding window: O(N W) worst case because insertion/deletion shifts array elements.
 */
export function medianFilter(v: Float64Array, size: number): Float64Array {
  const n = v.length;
  const out = new Float64Array(n);
  if (n === 0) return out;
  if (size <= 1) {
    out.set(v);
    return out;
  }

  const half = Math.floor(size / 2);
  // Initial window
  const win: number[] = [];
  for (let j = -half; j <= half; j++) {
    const clamped = j < 0 ? 0 : j >= n ? n - 1 : j;
    win.push(v[clamped]);
  }
  win.sort((a, b) => a - b);
  out[0] = win[half];

  function binarySearch(arr: number[], val: number): number {
    let low = 0;
    let high = arr.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (arr[mid] === val) return mid;
      if (arr[mid] < val) low = mid + 1;
      else high = mid - 1;
    }
    return low;
  }

  for (let i = 1; i < n; i++) {
    // Remove old sample falling out of the window
    const oldJ = i - 1 - half;
    const oldVal = v[oldJ < 0 ? 0 : oldJ >= n ? n - 1 : oldJ];
    const removeIdx = binarySearch(win, oldVal);
    win.splice(removeIdx, 1);

    // Add new sample entering the window
    const newJ = i + half;
    const newVal = v[newJ < 0 ? 0 : newJ >= n ? n - 1 : newJ];
    const insertIdx = binarySearch(win, newVal);
    win.splice(insertIdx, 0, newVal);

    out[i] = win[half];
  }

  return out;
}

/**
 * 1D sliding maximum filter matching scipy.ndimage.maximum_filter1d
 */
export function maximumFilter1d(d: Float64Array, size: number): Float64Array {
  const n = d.length;
  const out = new Float64Array(n);
  if (n === 0) return out;
  if (size <= 1) {
    out.set(d);
    return out;
  }

  const half = Math.floor(size / 2);
  for (let i = 0; i < n; i++) {
    const start = Math.max(0, i - half);
    const end = Math.min(n, i + size - half);
    let m = d[start];
    for (let j = start + 1; j < end; j++) {
      if (d[j] > m) m = d[j];
    }
    out[i] = m;
  }
  return out;
}

/**
 * Uniform 1D filter (moving average) with 'nearest' boundary mode matching scipy.ndimage.uniform_filter1d
 */
export function uniformFilter1d(arr: Float64Array, size: number): Float64Array {
  const n = arr.length;
  const out = new Float64Array(n);
  if (n === 0 || size <= 0) return out;
  if (size === 1) {
    out.set(arr);
    return out;
  }

  const half = Math.floor(size / 2);
  // Initial window sum
  let sum = 0;
  for (let j = -half; j < size - half; j++) {
    const idx = j < 0 ? 0 : j >= n ? n - 1 : j;
    sum += arr[idx];
  }
  out[0] = sum / size;

  for (let i = 1; i < n; i++) {
    const removeIdx = i - 1 - half;
    const addIdx = i + (size - 1 - half);
    const vRemove = arr[removeIdx < 0 ? 0 : removeIdx >= n ? n - 1 : removeIdx];
    const vAdd = arr[addIdx < 0 ? 0 : addIdx >= n ? n - 1 : addIdx];
    sum += vAdd - vRemove;
    out[i] = sum / size;
  }
  return out;
}

/**
 * Savitzky-Golay filter matching scipy.signal.savgol_filter(arr, windowSize, 3, mode="interp")
 */
export function savgolFilter(
  arr: Float64Array,
  windowSize: number,
  polyOrder = 3,
): Float64Array {
  const n = arr.length;
  const out = new Float64Array(n);
  if (n === 0) return out;
  if (windowSize <= polyOrder || n < windowSize) {
    out.set(arr);
    return out;
  }

  const half = Math.floor(windowSize / 2);
  const m = half;

  // Build Vandermonde matrix A for [-m .. m] with polynomial powers [0 .. polyOrder]
  // Normal equations: (A^T A) C = A^T
  const deg = polyOrder;
  const pCount = deg + 1;
  const ATA: number[][] = Array.from({ length: pCount }, () =>
    new Array(pCount).fill(0),
  );
  for (let x = -m; x <= m; x++) {
    for (let r = 0; r < pCount; r++) {
      for (let c = 0; c < pCount; c++) {
        ATA[r][c] += Math.pow(x, r + c);
      }
    }
  }

  // Invert ATA (small matrix, order 4 for cubic)
  const invATA = invertMatrix(ATA);

  // Center convolution weights (0th derivative: evaluating at x=0 selects row 0 of polynomial coefficients)
  // c_0 = sum_j (invATA[0][k] * x_j^k) * y_j
  const weights = new Float64Array(windowSize);
  for (let j = 0; j < windowSize; j++) {
    const x = j - m;
    let w = 0;
    for (let k = 0; k < pCount; k++) {
      w += invATA[0][k] * Math.pow(x, k);
    }
    weights[j] = w;
  }

  // Convolve for interior points [half .. n - 1 - half]
  for (let i = half; i < n - half; i++) {
    let acc = 0;
    for (let j = 0; j < windowSize; j++) {
      acc += weights[j] * arr[i - half + j];
    }
    out[i] = acc;
  }

  // Boundaries: mode="interp" in scipy
  // Fit polynomial of degree polyOrder to first windowSize points
  const pStart = fitPolynomial(Array.from(arr.subarray(0, windowSize)), deg);
  for (let i = 0; i < half; i++) {
    out[i] = evaluatePolynomial(pStart, i);
  }

  // Fit polynomial to last windowSize points
  const pEnd = fitPolynomial(Array.from(arr.subarray(n - windowSize, n)), deg);
  for (let i = n - half; i < n; i++) {
    out[i] = evaluatePolynomial(pEnd, i - (n - windowSize));
  }

  return out;
}

function invertMatrix(M: number[][]): number[][] {
  const n = M.length;
  const A = M.map((row) => row.slice());
  const I: number[][] = Array.from({ length: n }, (_, r) =>
    Array.from({ length: n }, (_, c) => (r === c ? 1 : 0)),
  );

  for (let i = 0; i < n; i++) {
    let pivot = A[i][i];
    let pivotRow = i;
    for (let r = i + 1; r < n; r++) {
      if (Math.abs(A[r][i]) > Math.abs(pivot)) {
        pivot = A[r][i];
        pivotRow = r;
      }
    }
    if (pivotRow !== i) {
      [A[i], A[pivotRow]] = [A[pivotRow], A[i]];
      [I[i], I[pivotRow]] = [I[pivotRow], I[i]];
    }

    const scale = A[i][i];
    for (let c = 0; c < n; c++) {
      A[i][c] /= scale;
      I[i][c] /= scale;
    }

    for (let r = 0; r < n; r++) {
      if (r !== i) {
        const factor = A[r][i];
        for (let c = 0; c < n; c++) {
          A[r][c] -= factor * A[i][c];
          I[r][c] -= factor * I[i][c];
        }
      }
    }
  }
  return I;
}

function fitPolynomial(y: number[], deg: number): number[] {
  const n = y.length;
  const pCount = deg + 1;
  const ATA: number[][] = Array.from({ length: pCount }, () =>
    new Array(pCount).fill(0),
  );
  const ATy: number[] = new Array(pCount).fill(0);

  for (let i = 0; i < n; i++) {
    for (let r = 0; r < pCount; r++) {
      const xr = Math.pow(i, r);
      ATy[r] += xr * y[i];
      for (let c = 0; c < pCount; c++) {
        ATA[r][c] += Math.pow(i, r + c);
      }
    }
  }

  const inv = invertMatrix(ATA);
  const coeffs = new Array(pCount).fill(0);
  for (let r = 0; r < pCount; r++) {
    for (let c = 0; c < pCount; c++) {
      coeffs[r] += inv[r][c] * ATy[c];
    }
  }
  return coeffs;
}

function evaluatePolynomial(coeffs: number[], x: number): number {
  let val = 0;
  for (let i = 0; i < coeffs.length; i++) {
    val += coeffs[i] * Math.pow(x, i);
  }
  return val;
}

/**
 * Precomputed Butterworth 5th order Highpass (0.5 Hz) SOS coefficients for fs = 512 Hz
 * Exact match to scipy.signal.butter(5, 0.5, btype="highpass", output="sos", fs=512)
 */
export const BUTTER_5_HIGHPASS_512_SOS: number[][] = [
  [0.9901209699369203, -0.9901209699369203, 0.0, 1.0, -0.9938828249141519, 0.0],
  [1.0, -2.0, 1.0, 1.0, -1.990083506472341, 0.9901209699371897],
  [1.0, -2.0, 1.0, 1.0, -1.9961774132794923, 0.996214991462574],
];

/**
 * Zero-phase forward-backward SOS filtering matching scipy.signal.sosfiltfilt
 */
export function sosFiltFilt(sos: number[][], x: Float64Array): Float64Array {
  if (x.length === 0) return new Float64Array(0);
  const ntaps =
    2 * sos.length +
    1 -
    Math.min(
      sos.filter((s) => s[2] === 0).length,
      sos.filter((s) => s[5] === 0).length,
    );
  const edge = 3 * ntaps;
  if (x.length <= edge)
    throw new Error(`Signal must contain more than ${edge} samples`);
  const padded = new Float64Array(x.length + 2 * edge);
  for (let i = 0; i < edge; i++) padded[i] = 2 * x[0] - x[edge - i];
  padded.set(x, edge);
  for (let i = 0; i < edge; i++)
    padded[edge + x.length + i] = 2 * x[x.length - 1] - x[x.length - 2 - i];
  let signal = filterCascade(sos, padded);
  signal.reverse();
  signal = filterCascade(sos, signal);
  signal.reverse();
  return signal.slice(edge, edge + x.length);
}

// Direct form II transposed with scipy.signal.sosfilt_zi steady-state initial conditions.
function filterCascade(sos: number[][], input: Float64Array): Float64Array {
  let signal = input;
  let scale = input[0];
  for (const sec of sos) {
    const [b0_, b1_, b2_, a0, a1_, a2_] = sec;
    const b0 = b0_ / a0,
      b1 = b1_ / a0,
      b2 = b2_ / a0;
    const a1 = a1_ / a0,
      a2 = a2_ / a0;
    const gain = (b0 + b1 + b2) / (1 + a1 + a2);
    let z1 = (gain - b0) * scale;
    let z2 = (b2 - a2 * gain) * scale;
    const output = new Float64Array(signal.length);
    for (let i = 0; i < signal.length; i++) {
      const value = b0 * signal[i] + z1;
      z1 = b1 * signal[i] - a1 * value + z2;
      z2 = b2 * signal[i] - a2 * value;
      output[i] = value;
    }
    scale *= gain;
    signal = output;
  }
  return signal;
}

/** Butterworth order 5, 0.5 Hz highpass; bilinear transform of the analog poles. */
export function butterHighpass(fs: number): number[][] {
  if (!Number.isFinite(fs) || fs < 100 || fs > 2000)
    throw new Error("Sampling rate must be 100–2000 Hz");
  if (fs === 512) return BUTTER_5_HIGHPASS_512_SOS;
  const c = Math.tan((Math.PI * 0.5) / fs);
  const realPole = (1 - c) / (1 + c);
  const sections = [[1, -1, 0, 1, -realPole, 0]];
  let gain = (1 + realPole) / 2;
  for (const angle of [Math.PI / 5, (2 * Math.PI) / 5]) {
    const pr = -Math.cos(angle),
      pi = Math.sin(angle);
    const denominator = (1 - c * pr) ** 2 + (c * pi) ** 2;
    const zr = (1 - c * c) / denominator;
    const zi = (-2 * c * pi) / denominator;
    const a1 = -2 * zr,
      a2 = zr * zr + zi * zi;
    sections.push([1, -2, 1, 1, a1, a2]);
    gain *= (1 - a1 + a2) / 4;
  }
  sections[0][0] = gain;
  sections[0][1] = -gain;
  return sections;
}

/** Moving-average FIR filtfilt, including odd padding and steady-state initialization. */
export function powerlineFilter(
  signal: Float64Array,
  fs: number,
  powerline = 50,
): Float64Array {
  const m = Math.max(2, Math.floor(fs / powerline));
  const edge = 3 * m;
  if (signal.length <= edge)
    throw new Error(`Signal must contain more than ${edge} samples`);
  const padded = new Float64Array(signal.length + 2 * edge);
  for (let i = 0; i < edge; i++) padded[i] = 2 * signal[0] - signal[edge - i];
  padded.set(signal, edge);
  for (let i = 0; i < edge; i++)
    padded[edge + signal.length + i] =
      2 * signal[signal.length - 1] - signal[signal.length - 2 - i];
  const pass = (x: Float64Array) => {
    const out = new Float64Array(x.length);
    const z = new Float64Array(m - 1);
    for (let k = 0; k < m - 1; k++) z[k] = ((m - 1 - k) / m) * x[0];
    for (let i = 0; i < x.length; i++) {
      out[i] = x[i] / m + z[0];
      for (let k = 0; k < m - 2; k++) z[k] = x[i] / m + z[k + 1];
      z[m - 2] = x[i] / m;
    }
    return out;
  };
  let output = pass(padded);
  output.reverse();
  output = pass(output);
  output.reverse();
  return output.slice(edge, edge + signal.length);
}

export function ecgClean(signal: Float64Array, fs = 512): Float64Array {
  return powerlineFilter(sosFiltFilt(butterHighpass(fs), signal), fs, 50);
}

/** NumPy arange semantics, including the representable effective step. */
export function sampleGrid(
  start: number,
  end: number,
  fs: number,
): Float64Array {
  const dt = 1 / fs;
  const count = Math.ceil((end - start) / dt);
  if (!Number.isFinite(count) || count <= 0 || count > 120000)
    throw new Error("Invalid or excessive signal duration");
  const step = start + dt - start;
  return Float64Array.from({ length: count }, (_, i) => start + i * step);
}
