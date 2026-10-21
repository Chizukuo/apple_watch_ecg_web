/** Copyright (C) 2026 Chizukuo. SPDX-License-Identifier: GPL-3.0-or-later */
import {
  PDFArray,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFRawStream,
  decodePDFRawStream,
} from "pdf-lib";
import { AnalysisError } from "../types";
import { checkDimensions, decodeImage, Pixels } from "../raster";

export function decodePdfImage(stream: PDFRawStream): Pixels {
  const d = stream.dict;
  const width = d.lookup(PDFName.of("Width"), PDFNumber).asNumber();
  const height = d.lookup(PDFName.of("Height"), PDFNumber).asNumber();
  checkDimensions(width, height);
  const filter = d.get(PDFName.of("Filter"))?.toString() ?? "";
  if (filter.includes("DCTDecode")) return decodeImage(stream.getContents());
  if (d.lookup(PDFName.of("BitsPerComponent"), PDFNumber).asNumber() !== 8)
    throw new AnalysisError("扫描 PDF 需使用 8 位 RGB/灰度图片");
  const space = d.lookup(PDFName.of("ColorSpace"));
  let channels =
    space?.toString() === "/DeviceRGB"
      ? 3
      : space?.toString() === "/DeviceGray"
        ? 1
        : 0;
  if (
    space instanceof PDFArray &&
    space.lookup(0)?.toString() === "/ICCBased"
  ) {
    const profile = space.lookup(1);
    if (profile instanceof PDFRawStream)
      channels = profile.dict.lookup(PDFName.of("N"), PDFNumber).asNumber();
  }
  if (!channels)
    throw new AnalysisError("扫描 PDF 色彩空间不支持，请导出 PNG/JPEG");
  const raw = decodePDFRawStream(stream).decode();
  const params = d.lookupMaybe(PDFName.of("DecodeParms"), PDFDict);
  const predictor =
    params?.lookupMaybe(PDFName.of("Predictor"), PDFNumber)?.asNumber() ?? 1;
  const stride = width * channels;
  if (predictor === 1 && raw.length === stride * height)
    return { width, height, channels, data: raw };
  if (predictor < 10 || predictor > 15 || raw.length !== (stride + 1) * height)
    throw new AnalysisError("扫描 PDF 图片编码无效");
  const data = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const mode = raw[y * (stride + 1)];
    if (mode > 4) throw new AnalysisError("扫描 PDF 图片过滤器无效");
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? data[y * stride + x - channels] : 0;
      const up = y ? data[(y - 1) * stride + x] : 0;
      const ul = y && x >= channels ? data[(y - 1) * stride + x - channels] : 0;
      const p = left + up - ul,
        pa = Math.abs(p - left),
        pb = Math.abs(p - up),
        pc = Math.abs(p - ul);
      const prediction =
        mode === 0
          ? 0
          : mode === 1
            ? left
            : mode === 2
              ? up
              : mode === 3
                ? Math.floor((left + up) / 2)
                : pa <= pb && pa <= pc
                  ? left
                  : pb <= pc
                    ? up
                    : ul;
      data[y * stride + x] = raw[y * (stride + 1) + x + 1] + prediction;
    }
  }
  return { width, height, channels, data };
}
