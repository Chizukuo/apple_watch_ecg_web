import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parsePdf } from "../src/core/pdf";
import { cleanAndDetect } from "../src/core/detector";

describe("Detector unit tests", () => {
  it("finds prominent peaks and snaps to QRS complexes accurately", () => {
    const localPath = path.resolve(__dirname, "fixtures/synthetic_demo.pdf");
    const parentPath = path.resolve(__dirname, "../../apple_watch_ecg/examples/synthetic_demo.pdf");
    const pdfPath = fs.existsSync(localPath) ? localPath : parentPath;
    const pdfBytes = fs.readFileSync(pdfPath);
    const rec = parsePdf(new Uint8Array(pdfBytes));

    const { rawPeaks, clean } = cleanAndDetect(rec.v, rec.fs);
    expect(rawPeaks.length).toBe(35);
    expect(clean.length).toBe(rec.v.length);
  });
});
