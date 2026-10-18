import { describe, it, expect } from "vitest";
import {
  mean,
  median,
  percentile,
  ptp,
  std,
  interp,
  gradient,
  detrend,
  corr,
  medianFilter,
  maximumFilter1d,
  uniformFilter1d,
  savgolFilter,
} from "../src/core/dsp";

describe("DSP functions", () => {
  it("calculates basic statistics accurately", () => {
    const data = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    expect(mean(data)).toBe(5);
    expect(median(data)).toBe(5);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(ptp(data)).toBe(8);
    expect(percentile(data, 50)).toBe(5);
    expect(percentile(data, 25)).toBe(3);
    expect(percentile(data, 75)).toBe(7);
  });

  it("interpolates linearly matching np.interp", () => {
    const xp = [0, 10, 20];
    const fp = [0, 100, 200];
    const x = [0, 5, 10, 15, 20, 25];
    const res = interp(x, xp, fp);
    expect(Array.from(res)).toEqual([0, 50, 100, 150, 200, 200]);
  });

  it("computes gradient matching np.gradient", () => {
    const x = new Float64Array([1, 2, 4, 7, 11]);
    const g = gradient(x);
    // g[0] = 2-1 = 1
    // g[1] = (4-1)/2 = 1.5
    // g[2] = (7-2)/2 = 2.5
    // g[3] = (11-4)/2 = 3.5
    // g[4] = 11-7 = 4
    expect(Array.from(g)).toEqual([1, 1.5, 2.5, 3.5, 4]);
  });

  it("detrends linear signals to zero", () => {
    const x = new Float64Array([10, 20, 30, 40, 50]);
    const d = detrend(x);
    for (let i = 0; i < d.length; i++) {
      expect(Math.abs(d[i])).toBeLessThan(1e-10);
    }
  });

  it("calculates correlation of detrended signals", () => {
    const a = new Float64Array([1, 5, 2, 8, 3, 9, 4, 10]);
    const b = new Float64Array([1, 5, 2, 8, 3, 9, 4, 10]);
    expect(corr(a, b)).toBeCloseTo(1.0, 5);

    const c = new Float64Array(a.map((v) => -v));
    expect(corr(a, c)).toBeCloseTo(-1.0, 5);
  });

  it("applies median filter with nearest mode", () => {
    const x = new Float64Array([10, 1, 1, 1, 20, 1, 1, 1, 10]);
    const f = medianFilter(x, 3);
    // at index 0: window [10, 10, 1] -> median 10
    // at index 1: window [10, 1, 1] -> median 1
    // at index 4: window [1, 20, 1] -> median 1
    expect(f[4]).toBe(1);
  });

  it("applies maximum filter matching scipy", () => {
    const x = new Float64Array([1, 2, 10, 2, 1]);
    const m = maximumFilter1d(x, 3);
    expect(m[1]).toBe(10);
    expect(m[2]).toBe(10);
    expect(m[3]).toBe(10);
  });

  it("preserves polynomials in savgolFilter", () => {
    const x = new Float64Array(20);
    for (let i = 0; i < 20; i++) x[i] = i * i;
    const s = savgolFilter(x, 15, 3);
    for (let i = 0; i < 20; i++) {
      expect(s[i]).toBeCloseTo(x[i], 4);
    }
  });
});
