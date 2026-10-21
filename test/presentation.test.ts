/** Copyright (C) 2026 Chizukuo. SPDX-License-Identifier: GPL-3.0-or-later */
import { it, expect } from "vitest";
import fs from "node:fs";
import { parsePdf } from "../src/core/pdf";
import { analyze } from "../src/core/pipeline";
import { assessment } from "../src/core/presentation";
import { renderDashboardSvg } from "../src/render/svg";
import { onRequestPost } from "../functions/api/analyze";

it("does not turn general notes into abnormal findings or skipped tests into normal findings", async () => {
  const rec = await parsePdf(
    fs.readFileSync("test/fixtures/synthetic_demo.pdf"),
  );
  const result = analyze(rec);
  const report = structuredClone(result.report);
  report.rhythm.n_premature_same =
    report.rhythm.n_premature_diff =
    report.rhythm.n_odd =
      0;
  expect(assessment(report).status).toBe("normal");
  report.morphology!.qt_reliable = false;
  report.morphology_alerts.skipped.push("T 波太低，未做 QTc 提醒");
  expect(assessment(report).qtc.status).toBe("unreliable");
  expect(assessment(report).status).toBe("unreliable");
  report.rhythm.n_odd = 1;
  expect(assessment(report).premature).toBe(0);
  expect(renderDashboardSvg(rec, { ...result, report })).not.toContain(
    "测量指标均在",
  );
});

it("keeps identity out of all default output and includes it only when explicitly requested", async () => {
  const bytes = fs.readFileSync("test/fixtures/synthetic_demo.pdf");
  const rec = await parsePdf(bytes);
  for (const format of ["svg", "json"]) {
    const request = new Request(
      `https://example.com/api/analyze?format=${format}`,
      { method: "POST", body: bytes },
    );
    const response = await onRequestPost({ request } as Parameters<
      typeof onRequestPost
    >[0]);
    const text = await response.text();
    expect(response.status).toBe(200);
    expect(text).not.toContain(rec.identity.name!);
    expect(text).not.toContain(rec.identity.dob!);
    expect(response.headers.get("cache-control")).toBe("no-store");
  }
  const request = new Request(
    "https://example.com/api/analyze?format=json&include_identity=1",
    { method: "POST", body: bytes },
  );
  const response = await onRequestPost({ request } as Parameters<
    typeof onRequestPost
  >[0]);
  const data = (await response.json()) as {
    identity: typeof rec.identity;
    source: string;
    tool_version: string;
  };
  expect(data.identity).toEqual(rec.identity);
  expect(data.source).toBe("vector");
  expect(data.tool_version).toBe("1.1.0");
});

it.each([
  "exclude=bad",
  "exclude=0-2junk",
  "placement=chest",
  "sex=M",
  "format=bogus",
  "include_identity=yes",
])("rejects invalid analysis parameters: %s", async (query) => {
  const url = new URL(`https://example.com/api/analyze?${query}`);
  if (!url.searchParams.has("format")) url.searchParams.set("format", "json");
  const request = new Request(url.toString(), {
    method: "POST",
    body: fs.readFileSync("test/fixtures/synthetic_demo.pdf"),
  });
  const response = await onRequestPost({ request } as Parameters<
    typeof onRequestPost
  >[0]);
  expect(response.status).toBe(400);
  expect(response.headers.get("cache-control")).toBe("no-store");
});
