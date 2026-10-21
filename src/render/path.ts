/** Copyright (C) 2026 Chizukuo. SPDX-License-Identifier: GPL-3.0-or-later */

/**
 * Encode the existing 0.1-unit SVG geometry with implicit line commands.
 * Trim trailing .0 without changing rounding or dropping any vertices.
 * Keep all samples, peaks, corners and reversals; no signal decimation.
 */
export function polylinePath(
  length: number,
  xAt: (i: number) => number,
  yAt: (i: number) => number,
): string {
  const parts: string[] = [];
  const coordinate = (value: number) => {
    const rounded = value.toFixed(1);
    return rounded.endsWith(".0") ? rounded.slice(0, -2) : rounded;
  };
  for (let i = 0; i < length; i++) {
    parts.push(`${coordinate(xAt(i))} ${coordinate(yAt(i))}`);
  }
  return parts.length ? "M" + parts.join(" ") : "";
}
