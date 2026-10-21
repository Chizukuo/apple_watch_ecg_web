/**
 * PDF 2D affine graphics state machine and vector path extractor
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { contentTokens } from "./content";
import { AnalysisError } from "../types";
import {
  GraphicsState,
  LineSegment,
  Matrix,
  PaintedPath,
  Point2D,
} from "./types";

export function identityMatrix(): Matrix {
  return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
}

/**
 * Multiplies two 2D affine matrices: M_new = M2 * M1
 */
export function multiplyMatrix(m2: Matrix, m1: Matrix): Matrix {
  return {
    a: m2.a * m1.a + m2.b * m1.c,
    b: m2.a * m1.b + m2.b * m1.d,
    c: m2.c * m1.a + m2.d * m1.c,
    d: m2.c * m1.b + m2.d * m1.d,
    e: m2.e * m1.a + m2.f * m1.c + m1.e,
    f: m2.e * m1.b + m2.f * m1.d + m1.f,
  };
}

/**
 * Transforms point (x, y) by matrix and converts to top-down page coordinates.
 */
export function transformPoint(
  m: Matrix,
  x: number,
  y: number,
  pageHeight: number,
): Point2D {
  const xPdf = m.a * x + m.c * y + m.e;
  const yPdf = m.b * x + m.d * y + m.f;
  return { x: Math.fround(xPdf), y: Math.fround(pageHeight - yPdf) };
}

export function isGray(
  c: [number, number, number],
  lo: number,
  hi: number,
): boolean {
  const max = Math.max(...c);
  const min = Math.min(...c);
  return max - min < 0.03 && c[0] >= lo && c[0] <= hi;
}

export function isRed(c: [number, number, number]): boolean {
  return c[0] > 0.6 && c[1] < 0.35 && c[2] < 0.35;
}

/**
 * Extracts vector line segments from raw PDF stream tokens with CTM affine support
 */
export function extractPaintedPaths(
  streamStr: string | readonly string[],
  pageHeight = 612,
): PaintedPath[] {
  const tokens =
    typeof streamStr === "string" ? contentTokens(streamStr) : streamStr;
  const paintedPaths: PaintedPath[] = [];

  let state: GraphicsState = {
    ctm: identityMatrix(),
    strokeColor: [0, 0, 0],
    fillColor: [0, 0, 0],
  };
  const stateStack: GraphicsState[] = [];

  let curPt: Point2D | null = null;
  let pathSegs: LineSegment[] = [];
  let pathPoints: Point2D[] = [];

  let inText = false;
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok === "BT") {
      inText = true;
      continue;
    }
    if (tok === "ET") {
      inText = false;
      continue;
    }
    if (inText) continue;
    if (
      stateStack.length > 128 ||
      paintedPaths.length > 100000 ||
      pathPoints.length > 100000
    )
      throw new AnalysisError("PDF 图形结构过于复杂");

    if (tok === "n") {
      pathSegs = [];
      pathPoints = [];
      curPt = null;
    } else if (tok === "q") {
      stateStack.push({
        ctm: { ...state.ctm },
        strokeColor: [...state.strokeColor],
        fillColor: [...state.fillColor],
      });
    } else if (tok === "Q") {
      if (stateStack.length > 0) {
        state = stateStack.pop()!;
      }
    } else if (tok === "cm") {
      const a = parseFloat(tokens[i - 6]);
      const b = parseFloat(tokens[i - 5]);
      const c = parseFloat(tokens[i - 4]);
      const d = parseFloat(tokens[i - 3]);
      const e = parseFloat(tokens[i - 2]);
      const f = parseFloat(tokens[i - 1]);
      if (
        !isNaN(a) &&
        !isNaN(b) &&
        !isNaN(c) &&
        !isNaN(d) &&
        !isNaN(e) &&
        !isNaN(f)
      ) {
        state.ctm = multiplyMatrix({ a, b, c, d, e, f }, state.ctm);
      }
    } else if (tok === "RG") {
      const r = parseFloat(tokens[i - 3]);
      const g = parseFloat(tokens[i - 2]);
      const b = parseFloat(tokens[i - 1]);
      if (!isNaN(r) && !isNaN(g) && !isNaN(b)) state.strokeColor = [r, g, b];
    } else if (tok === "rg") {
      const r = parseFloat(tokens[i - 3]);
      const g = parseFloat(tokens[i - 2]);
      const b = parseFloat(tokens[i - 1]);
      if (!isNaN(r) && !isNaN(g) && !isNaN(b)) state.fillColor = [r, g, b];
    } else if (tok === "G") {
      const gVal = parseFloat(tokens[i - 1]);
      if (!isNaN(gVal)) state.strokeColor = [gVal, gVal, gVal];
    } else if (tok === "g") {
      const gVal = parseFloat(tokens[i - 1]);
      if (!isNaN(gVal)) state.fillColor = [gVal, gVal, gVal];
    } else if (tok === "SC" || tok === "SCN") {
      const p1 = parseFloat(tokens[i - 1]);
      const p2 = parseFloat(tokens[i - 2]);
      const p3 = parseFloat(tokens[i - 3]);
      if (!isNaN(p3) && !isNaN(p2) && !isNaN(p1)) {
        state.strokeColor = [p3, p2, p1];
      } else if (!isNaN(p1)) {
        state.strokeColor = [p1, p1, p1];
      }
    } else if (tok === "sc" || tok === "scn") {
      const p1 = parseFloat(tokens[i - 1]);
      const p2 = parseFloat(tokens[i - 2]);
      const p3 = parseFloat(tokens[i - 3]);
      if (!isNaN(p3) && !isNaN(p2) && !isNaN(p1)) {
        state.fillColor = [p3, p2, p1];
      } else if (!isNaN(p1)) {
        state.fillColor = [p1, p1, p1];
      }
    } else if (tok === "m") {
      const x = parseFloat(tokens[i - 2]);
      const y = parseFloat(tokens[i - 1]);
      if (!isNaN(x) && !isNaN(y)) {
        curPt = transformPoint(state.ctm, x, y, pageHeight);
        pathPoints.push(curPt);
      }
    } else if (tok === "l") {
      const x = parseFloat(tokens[i - 2]);
      const y = parseFloat(tokens[i - 1]);
      if (!isNaN(x) && !isNaN(y)) {
        const nextPt = transformPoint(state.ctm, x, y, pageHeight);
        pathPoints.push(nextPt);
        if (curPt) pathSegs.push({ p1: curPt, p2: nextPt });
        curPt = nextPt;
      }
    } else if (tok === "c") {
      const x3 = parseFloat(tokens[i - 2]);
      const y3 = parseFloat(tokens[i - 1]);
      if (!isNaN(x3) && !isNaN(y3)) {
        const nextPt = transformPoint(state.ctm, x3, y3, pageHeight);
        pathPoints.push(nextPt);
        if (curPt) pathSegs.push({ p1: curPt, p2: nextPt });
        curPt = nextPt;
      }
    } else if (tok === "S" || tok === "s") {
      if (pathSegs.length > 0 || pathPoints.length > 0) {
        paintedPaths.push({
          color: [...state.strokeColor],
          segs: pathSegs,
          points: pathPoints,
        });
        pathSegs = [];
        pathPoints = [];
      }
    } else if (tok === "f" || tok === "F" || tok === "B" || tok === "b") {
      if (pathSegs.length > 0 || pathPoints.length > 0) {
        paintedPaths.push({
          color: [...state.fillColor],
          segs: pathSegs,
          points: pathPoints,
        });
        pathSegs = [];
        pathPoints = [];
      }
    }
  }

  return paintedPaths;
}
