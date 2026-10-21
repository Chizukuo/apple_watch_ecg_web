/**
 * Pure TypeScript Apple Watch Quartz PDF Parser and Signal Extractor
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { readDocument } from "./document";
import { AnalysisError, DEFAULT_FS, Recording } from "../types";
import { stitch } from "../signal";
import { extractRaster } from "../raster";
import { extractText } from "./content";
import { extractPaintedPaths } from "./graphics";
import { parsePdfText } from "./metadata";
import { extractVectorRows, findGridStrips } from "./vector";

export * from "./types";
export * from "./encoding";
export * from "./graphics";
export * from "./metadata";
export * from "./vector";

/**
 * Parses raw Apple Watch ECG PDF bytes and reconstructs the continuous 30-second vector signal.
 */
export async function parsePdf(pdfBytes: Uint8Array): Promise<Recording> {
  const document = await readDocument(pdfBytes);
  const vectorStreamStr = document.pages[0].content;
  const fullText = document.pages
    .map((page) => extractText(page.content, page.fonts))
    .join("\n");

  // 3. Parse metadata and properties
  const { watch, identity } = parsePdfText(fullText);
  const { exported_at, ios_build } = document.properties;
  if (exported_at) watch.exported_at = exported_at;
  if (ios_build) watch.ios_build = ios_build;

  const fs =
    watch.sampling_rate_hz >= 100 && watch.sampling_rate_hz <= 2000
      ? watch.sampling_rate_hz
      : DEFAULT_FS;
  if (!(
    watch.paper_speed_mm_s > 0 &&
    watch.paper_speed_mm_s <= 100 &&
    watch.gain_mm_mv > 0 &&
    watch.gain_mm_mv <= 100
  ))
    throw new AnalysisError("纸速或增益不在有效范围内");

  // 4. Extract vector drawings and identify grid strips
  const pageHeight = document.pages[0].height;
  const paintedPaths = extractPaintedPaths(vectorStreamStr, pageHeight);
  const strips = findGridStrips(paintedPaths);

  // 5. Extract rows and resample
  let { rows, notes } = extractVectorRows(paintedPaths, strips, watch, fs);
  if (fs !== watch.sampling_rate_hz)
    notes.push(`采样率元数据超出 100–2000 Hz，按 ${fs} Hz 重采样`);
  let source: "vector" | "raster" = "vector";
  if (!rows.length) {
    ({ rows, notes } = extractRaster(document.pages[0].raster(), watch, fs));
    source = "raster";
  }

  if (rows.length === 0) {
    throw new AnalysisError(
      "未在 PDF 中识别到心电图波形，请确保上传的是 Apple Watch 健康 App 导出的原始心电图 PDF",
    );
  }

  const digest = new Uint8Array(await crypto.subtle.digest("SHA-1", pdfBytes));
  const hash = Array.from(digest, (x) => x.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 8);
  const recordId = watch.recorded_at
    ? "ECG_" +
      watch.recorded_at.replace(/-/g, "").replace(/:/g, "").replace(/ /g, "_")
    : "ECG_" + hash;

  if (
    rows.length !== 3 ||
    rows.some((r, i) => r.index !== i || r.t.length < 9 * fs)
  )
    throw new AnalysisError("记录不完整：需要三行各约 10 秒的心电波形");
  const { t, v, clip } = stitch(rows, fs);
  if (t[t.length - 1] < 29 || t[t.length - 1] > 31)
    throw new AnalysisError("记录覆盖时长异常，请核对完整 PDF");

  return {
    watch,
    identity,
    rows,
    source,
    fs,
    record_id: recordId,
    t,
    v,
    clip,
    notes,
  };
}
