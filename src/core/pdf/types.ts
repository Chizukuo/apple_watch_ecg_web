/**
 * PDF parser internal types and geometry definitions
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface Point2D {
  x: number;
  y: number;
}

export interface LineSegment {
  p1: Point2D;
  p2: Point2D;
}

export interface Matrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export interface GraphicsState {
  ctm: Matrix;
  strokeColor: [number, number, number];
  fillColor: [number, number, number];
}

export interface PaintedPath {
  color: [number, number, number];
  segs: LineSegment[];
  points: Point2D[];
}

export interface GridStrip {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export type CMap = Map<number, string>;
