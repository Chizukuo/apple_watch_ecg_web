/** Copyright (C) 2026 Chizukuo. SPDX-License-Identifier: GPL-3.0-or-later */
import { expect, it } from "vitest";
import { onRequestPost } from "../functions/api/analyze";
import { parseCMap } from "../src/core/pdf/encoding";
import { extractText } from "../src/core/pdf/content";
import { extractPaintedPaths } from "../src/core/pdf/graphics";
import { pythonRound } from "../src/core/round";

it("rejects oversized streaming uploads before parsing a PDF", async () => {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(15 * 1024 * 1024 + 1));
      controller.close();
    },
  });
  const request = new Request("http://localhost/api/analyze?format=json", {
    method: "POST",
    body,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  const response = await onRequestPost({ request } as Parameters<
    typeof onRequestPost
  >[0]);
  expect(response.status).toBe(413);
});

it("bounds CMap expansion and decodes UTF-16 multi-character entries and ranges", () => {
  expect(() =>
    parseCMap("beginbfrange <0000> <ffffffff> <0000> endbfrange"),
  ).toThrow(/过大/);
  const cmap = parseCMap(
    "beginbfchar <01> <00410042> endbfchar beginbfrange <02> <03> [<0043> <0044>] endbfrange",
  );
  expect(cmap.get(1)).toBe("AB");
  expect(cmap.get(2)).toBe("C");
  expect(cmap.get(3)).toBe("D");
});

it("does not interpret comments or literal text as drawing commands", () => {
  const content =
    "% 1 0 0 RG 10 10 m\nBT /Some-Font 9 Tf 1 0 0 1 0 20 Tm (Alice \\(test\\) m l) Tj ET";
  expect(extractPaintedPaths(content)).toEqual([]);
  expect(extractText(content, new Map())).toBe("Alice (test) m l");
});

it("joins text objects on the same baseline so fragmented classification text remains readable", () => {
  const content =
    "BT /F1 10 Tf 1 0 0 1 20 100 Tm (Sinus Rhythm - ) Tj ET BT /F1 10 Tf 1 0 0 1 140 100 Tm (72 BPM) Tj ET";
  expect(extractText(content, new Map())).toBe("Sinus Rhythm - 72 BPM");
});

it.each([
  [2.5, 0, 2],
  [3.5, 0, 4],
  [-2.5, 0, -2],
  [2.675, 2, 2.67],
  [1.125, 2, 1.12],
  [1.375, 2, 1.38],
])("matches CPython round(%s, %s)", (input, digits, expected) => {
  expect(pythonRound(input, digits)).toBe(expected);
});
