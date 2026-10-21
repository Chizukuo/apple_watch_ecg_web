import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { onRequestPost } from "../functions/api/analyze";

describe("API endpoint /api/analyze", () => {
  const localPdf = path.resolve(__dirname, "fixtures/synthetic_demo.pdf");
  const parentPdf = path.resolve(
    __dirname,
    "../../apple_watch_ecg/examples/synthetic_demo.pdf",
  );
  const pdfPath = fs.existsSync(localPdf) ? localPdf : parentPdf;

  it("handles direct binary POST returning vector SVG", async () => {
    const pdfBytes = fs.readFileSync(pdfPath);
    const req = new Request("https://example.com/api/analyze?format=svg", {
      method: "POST",
      headers: { "Content-Type": "application/pdf" },
      body: pdfBytes,
    });

    const res = await (onRequestPost as any)({ request: req });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("image/svg+xml");
    const svg = await res.text();
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("窦性心律");
    expect(svg).toContain("QRS 66 ms");
  });

  it("handles multipart/form-data POST returning structured JSON", async () => {
    const pdfBytes = fs.readFileSync(pdfPath);
    const formData = new FormData();
    const blob = new Blob([pdfBytes], { type: "application/pdf" });
    formData.append("file", blob, "demo.pdf");

    const req = new Request("https://example.com/api/analyze?format=json", {
      method: "POST",
      body: formData,
    });

    const res = await (onRequestPost as any)({ request: req });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.code).toBe(0);
    expect(json.record_id).toBe("ECG_20261013_1125");
    expect(json.rhythm.beats).toBe(35);
    expect(json.rhythm.n_normal).toBe(33);
    expect(json.rhythm.n_premature_same).toBe(1);
    expect(json.rhythm.n_premature_diff).toBe(1);
    expect(json.morphology.qrs_ms).toBeCloseTo(66, 0);
    expect(json.svg.startsWith("<svg")).toBe(true);
  });

  it("rejects empty or too small files with 400 status", async () => {
    const req = new Request("https://example.com/api/analyze?format=json", {
      method: "POST",
      body: new Uint8Array([1, 2, 3]),
    });

    const res = await (onRequestPost as any)({ request: req });
    expect(res.status).toBe(400);
  });

  it("rejects non-PDF files missing %PDF header with 400 status", async () => {
    const fakeData = new Uint8Array(100).fill(65); // "AAAA..."
    const req = new Request("https://example.com/api/analyze?format=json", {
      method: "POST",
      body: fakeData,
    });

    const res = await (onRequestPost as any)({ request: req });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("%PDF");
  });
});
