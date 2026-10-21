/** Copyright (C) 2026 Chizukuo. SPDX-License-Identifier: GPL-3.0-or-later */
import { parsePdf, parsePdfText } from "./pdf";
import { decodeImage, extractRaster } from "./raster";
import { stitch } from "./signal";
import { AnalysisError, DEFAULT_FS, Recording } from "./types";

export async function loadRecording(bytes: Uint8Array): Promise<Recording> {
  if (
    bytes[0] === 37 &&
    bytes[1] === 80 &&
    bytes[2] === 68 &&
    bytes[3] === 70
  ) {
    try {
      return await parsePdf(bytes);
    } catch (e) {
      if (e instanceof AnalysisError) throw e;
      throw new AnalysisError("PDF 结构或压缩格式无效或不受支持");
    }
  }
  const { watch, identity } = parsePdfText("");
  const { rows, notes } = extractRaster(decodeImage(bytes), watch, DEFAULT_FS);
  if (
    rows.length !== 3 ||
    rows.some(
      (row, index) => row.index !== index || row.t.length < 9 * DEFAULT_FS,
    )
  )
    throw new AnalysisError("图片记录不完整：需要三行各约 10 秒的波形");
  const { t, v, clip } = stitch(rows, DEFAULT_FS);
  const hash = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-1", bytes)),
    (x) => x.toString(16).padStart(2, "0"),
  )
    .join("")
    .slice(0, 8);
  notes.push("图片没有文字层：记录时间、手表结论等信息为空");
  return {
    watch,
    identity,
    rows,
    notes,
    t,
    v,
    clip,
    fs: DEFAULT_FS,
    source: "raster",
    record_id: "ECG_" + hash,
  };
}
