/** Copyright (C) 2026 Chizukuo. SPDX-License-Identifier: GPL-3.0-or-later */
import { decode as decodePng, convertIndexedToRgb } from "fast-png";
import { decode as decodeJpeg } from "jpeg-js";
import { AnalysisError, Row, WatchInfo } from "./types";
import { interp, median, sampleGrid } from "./dsp";
import { Inflate } from "pako";

export interface Pixels {
  width: number;
  height: number;
  data: Uint8Array;
  channels: number;
}
export const MAX_PIXELS = 8_000_000;
export function checkDimensions(width: number, height: number) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width * height > MAX_PIXELS
  )
    throw new AnalysisError("图片尺寸无效或超过 800 万像素，请缩小图片");
}
function boundedPng(bytes: Uint8Array): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: Uint8Array[] = [bytes.subarray(0, 8)],
    compressed: Uint8Array[] = [];
  let offset = 8,
    count = 0,
    compressedSize = 0;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset),
      end = offset + 12 + length;
    if (end > bytes.length || ++count > 4096)
      throw new AnalysisError("PNG 数据不完整或分块过多");
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    // No image-analysis use for text or embedded profiles; omit them before decoding.
    if (["IHDR", "PLTE", "tRNS", "IDAT", "IEND"].includes(type))
      chunks.push(bytes.subarray(offset, end));
    else if (type[0] === type[0].toUpperCase())
      throw new AnalysisError("不支持此 PNG 关键分块");
    if (type === "IDAT") {
      compressed.push(bytes.subarray(offset + 8, end - 4));
      compressedSize += length;
    }
    offset = end;
    if (type === "IEND") break;
  }
  const input = new Uint8Array(compressedSize);
  let start = 0;
  for (const chunk of compressed) {
    input.set(chunk, start);
    start += chunk.length;
  }
  let expanded = 0;
  const inflater = new Inflate({ chunkSize: 16384 });
  inflater.onData = (chunk) => {
    expanded += chunk.length;
    if (expanded > 32 * 1024 * 1024)
      throw new AnalysisError("PNG 解压内容超过 32MB");
  };
  inflater.push(input, true);
  if (inflater.err) throw new AnalysisError("PNG 压缩内容无效");
  const output = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  start = 0;
  for (const chunk of chunks) {
    output.set(chunk, start);
    start += chunk.length;
  }
  return output;
}
export function decodeImage(bytes: Uint8Array): Pixels {
  try {
    if (
      bytes[0] === 137 &&
      bytes[1] === 80 &&
      bytes[2] === 78 &&
      bytes[3] === 71
    ) {
      if (bytes.length < 33) throw new Error("Invalid PNG");
      const view = new DataView(
        bytes.buffer,
        bytes.byteOffset,
        bytes.byteLength,
      );
      checkDimensions(view.getUint32(16), view.getUint32(20));
      const decoded = decodePng(boundedPng(bytes), { checkCrc: true });
      if (decoded.palette)
        return {
          width: decoded.width,
          height: decoded.height,
          data: convertIndexedToRgb(decoded),
          channels: decoded.palette[0].length,
        };
      if (decoded.depth !== 8) throw new AnalysisError("请使用 8 位 PNG 图片");
      return {
        width: decoded.width,
        height: decoded.height,
        data: new Uint8Array(decoded.data),
        channels: decoded.channels,
      };
    }
    if (bytes[0] === 255 && bytes[1] === 216) {
      const decoded = decodeJpeg(bytes, {
        useTArray: true,
        formatAsRGBA: true,
        tolerantDecoding: false,
        maxResolutionInMP: 8,
        maxMemoryUsageInMB: 80,
      });
      checkDimensions(decoded.width, decoded.height);
      return { ...decoded, channels: 4 };
    }
  } catch (e) {
    if (e instanceof AnalysisError) throw e;
    throw new AnalysisError("无法解码图片；请提供完整 PNG 或 JPEG");
  }
  throw new AnalysisError("仅支持 PDF、PNG 或 JPEG");
}

function runs(indices: number[], minLength: number): [number, number][] {
  const output: [number, number][] = [];
  for (const value of indices) {
    const previous = output.at(-1);
    if (previous && previous[1] + 1 === value) previous[1] = value;
    else output.push([value, value]);
  }
  return output.filter(([a, b]) => b - a + 1 >= minLength);
}

/** Port of Python extract_raster, preserving calibration, steep-column endpoints and row geometry. */
export function extractRaster(
  image: Pixels,
  watch: WatchInfo,
  fs: number,
): { rows: Row[]; notes: string[] } {
  const { width: w, height: h, data, channels } = image;
  checkDimensions(w, h);
  if (data.length !== w * h * channels || ![1, 2, 3, 4].includes(channels))
    throw new AnalysisError("图片通道无效");
  const grid = new Uint8Array(w * h),
    red = new Uint8Array(w * h),
    dark = new Uint8Array(w * h);
  const gridRows = new Uint32Array(h);
  for (let i = 0; i < w * h; i++) {
    const j = i * channels;
    const alpha =
      channels === 2 || channels === 4 ? data[j + channels - 1] / 255 : 1;
    const r = Math.round(data[j] * alpha + 255 * (1 - alpha));
    const g = Math.round(
      data[j + (channels >= 3 ? 1 : 0)] * alpha + 255 * (1 - alpha),
    );
    const b = Math.round(
      data[j + (channels >= 3 ? 2 : 0)] * alpha + 255 * (1 - alpha),
    );
    const max = Math.max(r, g, b),
      min = Math.min(r, g, b),
      delta = max - min;
    const sat = max ? Math.round((255 * delta) / max) : 0;
    let hue = delta
      ? (max === r
          ? (g - b) / delta
          : max === g
            ? 2 + (b - r) / delta
            : 4 + (r - g) / delta) * 30
      : 0;
    if (hue < 0) hue += 180;
    hue = Math.round(hue) % 180;
    red[i] = (hue <= 12 || hue >= 165) && sat > 90 && max > 70 ? 1 : 0;
    grid[i] = sat < 35 && max > 165 && max < 245 ? 1 : 0;
    dark[i] = sat < 40 && max < 160 ? 1 : 0;
    gridRows[Math.floor(i / w)] += grid[i];
  }
  const bands: [number, number][] = [];
  const candidates = runs(
    Array.from(gridRows, (v, i) => (v / w > 0.06 ? i : -1)).filter(
      (i) => i >= 0,
    ),
    2,
  );
  for (const [a, b] of candidates) {
    const previous = bands.at(-1);
    if (previous && a - previous[1] <= Math.max(4, Math.floor(h / 100)))
      previous[1] = b;
    else bands.push([a, b]);
  }
  const selected = bands
    .filter(([a, b]) => b - a >= Math.max(10, Math.floor(h / 40)))
    .sort((a, b) => b[1] - b[0] - (a[1] - a[0]))
    .slice(0, 3)
    .sort((a, b) => a[0] - b[0]);
  if (!selected.length) throw new AnalysisError("图片中找不到心电图网格");
  const geometry: [number, number, number, number, number][] = [],
    speeds: number[] = [];
  let calibration: number | null = null;
  for (let row = 0; row < selected.length; row++) {
    const [y0, y1] = selected[row],
      cols: number[] = [];
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let y = y0; y <= y1; y++) sum += grid[y * w + x];
      if (sum / (y1 - y0 + 1) > 0.5) cols.push(x);
    }
    if (cols.length < 2) continue;
    const groups: number[][] = [];
    for (const x of cols) {
      const previous = groups.at(-1);
      if (
        previous &&
        x - previous[previous.length - 1] <= Math.max(6, Math.floor(w / 30))
      )
        previous.push(x);
      else groups.push([x]);
    }
    groups.sort((a, b) => b[b.length - 1] - b[0] - (a[a.length - 1] - a[0]));
    const gx0 = groups[0][0],
      gx1 = groups[0].at(-1)!,
      speed = (gx1 - gx0) / 10;
    speeds.push(speed);
    if (row === 0) {
      const ys: number[] = [];
      for (let y = y0; y <= y1; y++)
        for (let x = gx0; x < gx0 + Math.floor(0.6 * speed); x++)
          if (dark[y * w + x]) {
            ys.push(y - y0);
            break;
          }
      if (
        ys.length &&
        0.25 * speed < ys.at(-1)! - ys[0] &&
        ys.at(-1)! - ys[0] < 0.8 * speed
      )
        calibration = ys.at(-1)! - ys[0];
    }
    geometry.push([row, y0, y1, gx0, gx1]);
  }
  if (!speeds.length) throw new AnalysisError("图片中找不到网格的左右边界");
  const speed = median(speeds),
    gain = calibration ?? (speed / watch.paper_speed_mm_s) * watch.gain_mm_mv;
  const notes = calibration
    ? []
    : ["图片中未找到定标方波，电压按纸速和增益推算"];
  notes.push(
    `光栅提取：${speed.toFixed(1)} 像素/秒，${gain.toFixed(1)} 像素/mV；精度低于矢量 PDF。已知偏差：QRS 可能偏宽（最多约 25 ms），截断无法可靠判断`,
  );
  const rows: Row[] = [];
  for (const [index, y0, y1, x0, x1] of geometry) {
    const occupied: number[] = [];
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++)
        if (red[y * w + x]) {
          occupied.push(y - y0);
          break;
        }
    if (!occupied.length) continue;
    let previous = median(occupied);
    const xs: number[] = [],
      ys: number[] = [];
    for (let x = x0; x <= x1; x++) {
      const column: number[] = [];
      for (let y = y0; y <= y1; y++) if (red[y * w + x]) column.push(y - y0);
      if (!column.length) continue;
      const first = column[0],
        last = column.at(-1)!;
      if (last - first <= 2) {
        previous = column.reduce((a, b) => a + b, 0) / column.length;
        xs.push(x - x0);
        ys.push(previous);
      } else {
        const near =
          Math.abs(first - previous) <= Math.abs(last - previous)
            ? first
            : last;
        const far = near === first ? last : first;
        xs.push(x - x0 - 0.25, x - x0 + 0.25);
        ys.push(near, far);
        previous = far;
      }
    }
    if (xs.length < 50) continue;
    const ta = xs.map((x) => index * 10 + x / speed),
      t = sampleGrid(ta[0], ta.at(-1)!, fs),
      y = interp(t, ta, ys),
      center = median(y);
    rows.push({
      index,
      t,
      v: Float64Array.from(y, (yy) => -(yy - center) / gain),
      clip: Uint8Array.from(y, (yy) => (yy <= 1 || yy >= y1 - y0 - 1 ? 1 : 0)),
    });
  }
  if (!rows.length) throw new AnalysisError("图片中找不到红色波形");
  return { rows, notes };
}
