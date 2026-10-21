/** Copyright (C) 2026 Chizukuo. SPDX-License-Identifier: GPL-3.0-or-later */
import { it, expect } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import { loadRecording } from "../src/core/load";
import { analyze } from "../src/core/pipeline";
import { renderDashboardSvg } from "../src/render/svg";
it("measures shortcut processing without timing assertions", async () => {
  mkdirSync("benchmark-results", { recursive: true });
  const bytes = readFileSync("test/fixtures/synthetic_demo.pdf");
  const current = { loadRecording, analyze, renderDashboardSvg };
  const implementations = [{ name: "current", ...current }];
  if (process.env.SHORTCUT_BENCH_BASELINE === "1") {
    const root = pathToFileURL(
      resolve("benchmark-results/shortcut-baseline/src"),
    ).href;
    implementations.push({
      name: "baseline",
      ...(await import(/* @vite-ignore */ `${root}/core/load.ts`)),
      ...(await import(/* @vite-ignore */ `${root}/core/pipeline.ts`)),
      ...(await import(/* @vite-ignore */ `${root}/render/svg.ts`)),
    });
  }
  const data: Record<string, unknown> = {
    runtime: process.version,
    fixture_sha256: createHash("sha256").update(bytes).digest("hex"),
    warmup: 8,
    iterations: 40,
    stages: ["parse", "analyze", "render", "total"],
  };
  const measurements = new Map(
    implementations.map(({ name }) => [name, [] as number[][]]),
  );
  let reference: ReturnType<typeof analyze>["report"] | undefined;
  let paths: number[][] | undefined;
  for (let i = 0; i < 48; i++) {
    // Alternate execution order to reduce systematic warmup/GC bias.
    const order = i % 2 ? [...implementations].reverse() : implementations;
    for (const impl of order) {
      const a = performance.now();
      const rec = await impl.loadRecording(bytes);
      const b = performance.now();
      const result = impl.analyze(rec);
      const c = performance.now();
      const svg = impl.renderDashboardSvg(rec, result);
      const d = performance.now();
      if (i >= 8)
        measurements.get(impl.name)!.push([b - a, c - b, d - c, d - a]);
      if (i === 0) {
        const coordinates = [...svg.matchAll(/<path d="([^"]+)"/g)].map((m) =>
          [...m[1].matchAll(/[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/gi)].map(
            (x) => Number(x[0]),
          ),
        );
        if (reference) {
          expect(result.report).toEqual(reference);
          expect(coordinates).toEqual(paths);
        } else {
          reference = result.report;
          paths = coordinates;
        }
        data[impl.name] = {
          svgBytes: Buffer.byteLength(svg),
          gzipBytes: gzipSync(svg).length,
        };
      }
    }
  }
  for (const [name, rows] of measurements) {
    const stats = rows[0].map((_, i) => {
      const s = rows.map((r) => r[i]).sort((a, b) => a - b);
      return {
        median: s[Math.floor(s.length / 2)],
        p95: s[Math.floor(s.length * 0.95)],
      };
    });
    data[name] = { ...(data[name] as object), stats };
  }
  writeFileSync(
    "benchmark-results/shortcut-benchmark.json",
    JSON.stringify(data, null, 2),
  );
  console.log(JSON.stringify(data));
});
