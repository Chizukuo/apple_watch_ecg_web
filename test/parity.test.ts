import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parsePdf } from "../src/core/pdf";
import { analyze } from "../src/core/pipeline";
import { renderDashboardSvg } from "../src/render/svg";

describe("Parity with Python apple_watch_ecg", () => {
  const localPdf = path.resolve(__dirname, "fixtures/synthetic_demo.pdf");
  const parentPdf = path.resolve(__dirname, "../../apple_watch_ecg/examples/synthetic_demo.pdf");
  const pdfPath = fs.existsSync(localPdf) ? localPdf : parentPdf;

  it("extracts metadata and signal accurately from synthetic_demo.pdf", () => {
    if (!fs.existsSync(pdfPath)) {
      console.warn("Skipping parity test: synthetic_demo.pdf not found at", pdfPath);
      return;
    }

    const pdfBytes = fs.readFileSync(pdfPath);
    const rec = parsePdf(new Uint8Array(pdfBytes));

    expect(rec.record_id).toBe("ECG_20261013_1125");
    expect(rec.watch.classification).toBe("窦性心律");
    expect(rec.watch.summary_text).toBe("此心电图未显示房颤迹象。");
    expect(rec.watch.reported_bpm).toBe(72);
    expect(rec.watch.paper_speed_mm_s).toBe(25.0);
    expect(rec.watch.gain_mm_mv).toBe(10.0);
    expect(rec.watch.sampling_rate_hz).toBe(512);
    expect(rec.watch.algorithm_version).toBe(2);

    // Continuous signal duration should be ~30s (>= 14000 samples at 512 Hz)
    expect(rec.t.length).toBeGreaterThan(14000);
    expect(rec.v.length).toBe(rec.t.length);

    // Run analysis pipeline
    const res = analyze(rec);
    const rep = res.report;

    expect(rep.rhythm.beats).toBe(35);
    expect(rep.rhythm.hr_bpm).toBeCloseTo(72.6, 1);
    expect(rep.rhythm.hr_nn_bpm).toBeCloseTo(72.0, 1);
    expect(rep.rhythm.rr_ms_min).toBeCloseTo(494.0, 0);
    expect(rep.rhythm.rr_ms_max).toBeCloseTo(1174.0, 0);
    expect(rep.rhythm.n_normal).toBe(33);
    expect(rep.rhythm.n_premature_same).toBe(1);
    expect(rep.rhythm.n_premature_diff).toBe(1);
    expect(rep.rhythm.n_odd).toBe(0);

    // Verify HRV metrics
    expect(rep.hrv.n_nn).toBe(30);
    expect(rep.hrv.mean_nn_ms).toBeCloseTo(833.3, 1);
    expect(rep.hrv.sdnn_ms).toBeCloseTo(0.9, 1);
    expect(rep.hrv.rmssd_ms).toBeCloseTo(1.6, 1);
    expect(rep.hrv.pnn50_pct).toBeCloseTo(0.0, 1);
    expect(rep.hrv.sd1_ms).toBeCloseTo(1.1, 1);
    expect(rep.hrv.sd2_ms).toBeCloseTo(0.7, 1);

    // Verify Morphology metrics
    expect(rep.morphology?.template_beats).toBe(31);
    expect(rep.morphology?.p_amp_mv).toBeCloseTo(0.098, 2);
    expect(rep.morphology?.p_polarity).toBe("直立");
    expect(rep.morphology?.pr_ms).toBeCloseTo(180.0, 0);
    expect(rep.morphology?.qrs_ms).toBeCloseTo(66.0, 0);
    expect(rep.morphology?.r_amp_mv).toBeCloseTo(0.943, 2);
    expect(rep.morphology?.s_amp_mv).toBeCloseTo(-0.283, 2);
    expect(rep.morphology?.st_j_mv).toBeCloseTo(-0.038, 2);
    expect(rep.morphology?.st_j60_mv).toBeCloseTo(0.005, 2);
    expect(rep.morphology?.t_amp_mv).toBeCloseTo(0.305, 2);
    expect(rep.morphology?.t_polarity).toBe("直立");
    expect(rep.morphology?.qt_ms).toBeCloseTo(363.0, 0);
    expect(rep.morphology?.qtc_bazett_ms).toBeCloseTo(398.0, 0);
    expect(rep.morphology?.qtc_fridericia_ms).toBeCloseTo(386.0, 0);
    expect(rep.morphology?.qt_reliable).toBe(true);

    // Verify PVC and PAC beats
    expect(rep.beats[9].time_s).toBeCloseTo(8.02, 1);
    expect(rep.beats[9].label).toBe("提前·QRS异形");
    expect(rep.beats[22].time_s).toBeCloseTo(18.943, 1);
    expect(rep.beats[22].label).toBe("提前·QRS同形");

    // Verify SVG generation runs without error and produces full SVG
    const svg = renderDashboardSvg(rec, res);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
    expect(svg).toContain("窦性心律");
    expect(svg).toContain("QRS 66 ms");
  });

  it.skipIf(!process.env.TEST_REAL_PDF_PATH || !fs.existsSync(process.env.TEST_REAL_PDF_PATH))(
    "extracts and analyzes real iOS Apple Watch PDF when TEST_REAL_PDF_PATH is provided",
    () => {
      const realPdfPath = process.env.TEST_REAL_PDF_PATH!;
      const pdfBytes = fs.readFileSync(realPdfPath);
      const rec = parsePdf(new Uint8Array(pdfBytes));

      expect(rec.record_id).toMatch(/^ECG_\d{8}_\d{4}$/);
      expect(rec.rows.length).toBeGreaterThanOrEqual(3);

      const res = analyze(rec);
      expect(res.report.rhythm.beats).toBeGreaterThan(0);
      expect(res.report.rhythm.hr_bpm).toBeGreaterThan(30);

      const svg = renderDashboardSvg(rec, res);
      expect(svg.startsWith("<svg")).toBe(true);
      expect(svg.endsWith("</svg>")).toBe(true);
    }
  );
});
