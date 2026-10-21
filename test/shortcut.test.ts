/** Copyright (C) 2026 Chizukuo. SPDX-License-Identifier: GPL-3.0-or-later */
import { expect, it } from "vitest";
import { contentTokens, extractText } from "../src/core/pdf/content";
import { extractPaintedPaths } from "../src/core/pdf/graphics";
import { polylinePath } from "../src/render/path";

it("preserves every rounded waveform vertex in compact SVG paths", () => {
  const values = [0, -0, 0.05, -0.05, 1.25, -1.25, 100, -12.345];
  for (let i = 0; i < 10000; i++)
    values.push(Math.sin(i * 0.07) * 200 + (i % 31 === 0 ? 100 : 0));
  const path = polylinePath(
    values.length,
    (i) => i / 10,
    (i) => values[i],
  );
  const coordinates = path.slice(1).split(" ").map(Number);
  expect(coordinates).toHaveLength(values.length * 2);
  for (let i = 0; i < values.length; i++) {
    expect(coordinates[i * 2]).toBe(Number((i / 10).toFixed(1)));
    expect(coordinates[i * 2 + 1]).toBe(Number(values[i].toFixed(1)));
  }
  expect(
    polylinePath(
      0,
      () => 0,
      () => 0,
    ),
  ).toBe("");
});

it("keeps PDF lexical boundaries for whitespace, comments, names and strings", () => {
  const text =
    "/F-1\t12\0Tf\n% ignore 1 0 0 RG\r\n[(a\\(b\\) c) -1 <0041>]/Name<< /ActualText (x) >>";
  expect(contentTokens(text)).toEqual([
    "/F-1",
    "12",
    "Tf",
    "[",
    "(a\\(b\\) c)",
    "-1",
    "<0041>",
    "]",
    "/Name",
    "<<",
    "/ActualText",
    "(x)",
    ">>",
  ]);
  expect(contentTokens("1\v2\f3\u00a04\u20285")).toEqual([
    "1",
    "2",
    "3",
    "4",
    "5",
  ]);
});

it("shares immutable tokens between PDF text and drawing extraction", () => {
  const source = "BT /F1 12 Tf (Hello) Tj ET 1 0 0 RG 0 0 m 10 10 l S";
  const tokens = Object.freeze(contentTokens(source));
  expect(extractText(tokens, new Map())).toBe("Hello");
  expect(extractPaintedPaths(tokens)).toEqual(extractPaintedPaths(source));
  expect(tokens).toEqual(contentTokens(source));
});
