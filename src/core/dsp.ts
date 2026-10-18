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
export function interp(x: Float64Array | number[], xp: Float64Array | number[], fp: Float64Array | number[]): Float64Array {
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
  return (sumProd / da.length) / (sa * sb);
}

/**
 * 1D median filter with 'nearest' boundary mode matching scipy.ndimage.median_filter(v, size, mode="nearest")
 * High-performance sliding window with binary search insertion/deletion for O(N log W) complexity.
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
    const end = Math.min(n, i + half + 1);
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
export function savgolFilter(arr: Float64Array, windowSize: number, polyOrder = 3): Float64Array {
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
  const ATA: number[][] = Array.from({ length: pCount }, () => new Array(pCount).fill(0));
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
    Array.from({ length: n }, (_, c) => (r === c ? 1 : 0))
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
  const ATA: number[][] = Array.from({ length: pCount }, () => new Array(pCount).fill(0));
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
  const n = x.length;
  if (n === 0) return new Float64Array(0);

  // Pad length
  const padLen = Math.min(n - 1, 3 * (2 * sos.length + 1));
  const totalLen = n + 2 * padLen;

  // Reflected padding matching scipy
  const y = new Float64Array(totalLen);
  const x0 = x[0];
  const xEnd = x[n - 1];

  for (let i = 0; i < padLen; i++) {
    y[i] = 2 * x0 - x[padLen - i];
  }
  y.set(x, padLen);
  for (let i = 0; i < padLen; i++) {
    y[padLen + n + i] = 2 * xEnd - x[n - 2 - i];
  }

  // Forward pass
  let signal: Float64Array<ArrayBufferLike> = y;
  for (let s = 0; s < sos.length; s++) {
    signal = sosFiltSection(sos[s], signal);
  }

  // Reverse
  signal.reverse();

  // Backward pass
  for (let s = 0; s < sos.length; s++) {
    signal = sosFiltSection(sos[s], signal);
  }

  // Reverse back
  signal.reverse();

  // Slice unpadded center
  return signal.subarray(padLen, padLen + n);
}

function sosFiltSection(sec: number[], x: Float64Array): Float64Array {
  const [b0, b1, b2, a0, a1, a2] = sec;
  const n = x.length;
  const y = new Float64Array(n);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;

  for (let i = 0; i < n; i++) {
    const xi = x[i];
    const yi = (b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    y[i] = yi;
    x2 = x1;
    x1 = xi;
    y2 = y1;
    y1 = yi;
  }
  return y;
}

/**
 * Zero-phase moving average filter for powerline noise (matching NeuroKit2 powerline filter)
 */
export function powerlineFilter(signal: Float64Array, fs: number, powerline = 50): Float64Array {
  const m = Math.max(2, Math.floor(fs / powerline));
  // Moving average forward and backward with zero phase
  const pass1 = uniformFilter1d(signal, m);
  const rev = new Float64Array(pass1).reverse();
  const pass2 = uniformFilter1d(rev, m);
  return pass2.reverse();
}

/**
 * ECG cleaning matching NeuroKit2's default pipeline:
 * 0.5 Hz highpass butterworth filter (order=5) + 50 Hz powerline filter
 */
export function ecgClean(signal: Float64Array, fs = 512): Float64Array {
  // 1. Highpass Butterworth 0.5 Hz
  const highpassed = sosFiltFilt(BUTTER_5_HIGHPASS_512_SOS, signal);
  // 2. Powerline filter (50 Hz)
  return powerlineFilter(highpassed, fs, 50);
}
