/**
 * Continuous signal stitching and baseline step compensation
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Row } from "./types";
import { interp, median, sampleGrid } from "./dsp";

export interface StitchedSignal {
  t: Float64Array;
  v: Float64Array;
  clip: Uint8Array;
}

/**
 * Stitches the strips into a continuous 30-second trace,
 * removing inter-strip baseline offset steps:
 * v_k(t) = v_k(t) - v_k(0) + v_{k-1}(end)
 */
export function stitch(rows: Row[], fs: number): StitchedSignal {
  const sorted = rows.slice().sort((a, b) => a.t[0] - b.t[0]);
  const ts: Float64Array[] = [];
  const vs: Float64Array[] = [];
  const cs: Float64Array[] = [];

  for (let r = 0; r < sorted.length; r++) {
    const row = sorted[r];
    let t = row.t;
    let v = new Float64Array(row.v);
    let c = new Float64Array(row.clip.length);
    for (let i = 0; i < row.clip.length; i++) c[i] = row.clip[i];

    if (ts.length > 0) {
      const prevT = ts[ts.length - 1];
      const prevTLast = prevT[prevT.length - 1];
      const prevV = vs[vs.length - 1];
      const prevVEndVal = prevV[prevV.length - 1];

      // Keep only t > prevTLast
      const keepIdx: number[] = [];
      for (let i = 0; i < t.length; i++) {
        if (t[i] > prevTLast) keepIdx.push(i);
      }

      if (keepIdx.length === 0) continue;

      const newT = new Float64Array(keepIdx.length);
      const newV = new Float64Array(keepIdx.length);
      const newC = new Float64Array(keepIdx.length);

      const v0 = v[keepIdx[0]];
      for (let i = 0; i < keepIdx.length; i++) {
        const idx = keepIdx[i];
        newT[i] = t[idx];
        newV[i] = v[idx] - v0 + prevVEndVal;
        newC[i] = c[idx];
      }

      t = newT;
      v = newV;
      c = newC;
    }

    ts.push(t);
    vs.push(v);
    cs.push(c);
  }

  // Concatenate all
  let totalLen = 0;
  for (const arr of ts) totalLen += arr.length;

  const tAll = new Float64Array(totalLen);
  const vAll = new Float64Array(totalLen);
  const cAll = new Float64Array(totalLen);

  let offset = 0;
  for (let i = 0; i < ts.length; i++) {
    tAll.set(ts[i], offset);
    vAll.set(vs[i], offset);
    cAll.set(cs[i], offset);
    offset += ts[i].length;
  }

  // Uniform grid from tAll[0] to tAll[last] with step 1.0 / fs
  const tU = sampleGrid(tAll[0], tAll[tAll.length - 1], fs);

  const vInterp = interp(tU, tAll, vAll);
  const vMed = median(vInterp);
  const vU = new Float64Array(vInterp.length);
  for (let i = 0; i < vInterp.length; i++) {
    vU[i] = vInterp[i] - vMed;
  }

  const cInterp = interp(tU, tAll, cAll);
  const clip = new Uint8Array(cInterp.length);
  for (let i = 0; i < cInterp.length; i++) {
    clip[i] = cInterp[i] > 0.5 ? 1 : 0;
  }

  return { t: tU, v: vU, clip };
}
