/** Copyright (C) 2026 Chizukuo. SPDX-License-Identifier: GPL-3.0-or-later */
import { it, expect } from "vitest";
import reference from "./fixtures/dsp-reference.json";
import {
  butterHighpass,
  sosFiltFilt,
  ecgClean,
  maximumFilter1d,
} from "../src/core/dsp";
for (const item of reference.cases) {
  it(`matches SciPy/NeuroKit filters with a DC offset and steps at ${item.fs} Hz`, () => {
    const input = new Float64Array(item.input);
    const high = sosFiltFilt(butterHighpass(item.fs), input);
    const clean = ecgClean(input, item.fs);
    expect(
      Math.max(...high.map((x, i) => Math.abs(x - item.highpass[i]))),
    ).toBeLessThan(1e-8);
    expect(
      Math.max(...clean.map((x, i) => Math.abs(x - item.clean[i]))),
    ).toBeLessThan(1e-8);
  });
}
for (const [size, expected] of Object.entries(reference.maximum.expected)) {
  it(`matches SciPy maximum_filter1d with size ${size}`, () => {
    expect(
      Array.from(
        maximumFilter1d(
          new Float64Array(reference.maximum.input),
          Number(size),
        ),
      ),
    ).toEqual(expected);
  });
}
