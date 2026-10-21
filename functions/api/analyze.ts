/** Copyright (C) 2026 Chizukuo. SPDX-License-Identifier: GPL-3.0-or-later */
import { loadRecording } from "../../src/core/load";
import { analyze } from "../../src/core/pipeline";
import { renderDashboardSvg } from "../../src/render/svg";
import {
  AnalysisError,
  PLACEMENTS,
  SEXES,
  Placement,
  Sex,
} from "../../src/core/types";
import { assessment } from "../../src/core/presentation";
import { signalCsv, summaryRow } from "../../src/core/export";

const MAX_FILE = 15 * 1024 * 1024;
const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};
class RequestError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export function parseExcludeParam(param: string | null): [number, number][] {
  if (!param) return [];
  if (param.length > 2048) throw new RequestError("排除时段参数过长");
  return param.split(",").map((part) => {
    const m = part.trim().match(/^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)$/);
    if (!m) throw new RequestError("exclude 格式应为 0-2,28-30（秒）");
    const a = Number(m[1]),
      b = Number(m[2]);
    if (
      !Number.isFinite(a) ||
      !Number.isFinite(b) ||
      a < 0 ||
      b <= a ||
      b > 300
    )
      throw new RequestError("排除时段须满足 0 ≤ 起点 < 终点 ≤ 300");
    return [a, b];
  });
}

async function readLimited(
  request: Request,
  limit: number,
): Promise<Uint8Array> {
  if (Number(request.headers.get("content-length")) > limit)
    throw new RequestError("文件过大（超过 15MB）", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new RequestError("上传文件为空");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) {
        await reader.cancel();
        throw new RequestError("文件过大（超过 15MB）", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

export const onRequestOptions: PagesFunction = async () =>
  new Response(null, {
    status: 204,
    headers: {
      ...HEADERS,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
export const onRequestGet: PagesFunction = async () =>
  new Response("请使用 POST 上传记录", {
    status: 405,
    headers: { ...HEADERS, Allow: "POST, OPTIONS" },
  });

export const onRequestPost: PagesFunction = async ({ request }) => {
  const url = new URL(request.url);
  const format = url.searchParams.get("format") || "svg";
  try {
    for (const key of url.searchParams.keys())
      if (url.searchParams.getAll(key).length > 1)
        throw new RequestError("分析参数不可重复");
    const svgOption = url.searchParams.get("include_svg") || "1";
    if (!["0", "1"].includes(svgOption))
      throw new RequestError("include_svg 只能是 0 或 1");
    if (!["json", "svg", "csv"].includes(format))
      throw new RequestError("format 只能是 json、svg 或 csv");
    const sex = url.searchParams.get("sex") || "unknown";
    const placement = url.searchParams.get("placement") || "wrist";
    if (!SEXES.includes(sex as Sex))
      throw new RequestError("sex 只能是 male、female 或 unknown");
    if (!PLACEMENTS.includes(placement as Placement))
      throw new RequestError("placement 只能是 wrist 或 other");
    const identityOption = url.searchParams.get("include_identity") || "0";
    if (!["0", "1"].includes(identityOption))
      throw new RequestError("include_identity 只能是 0 或 1");
    const includeIdentity = identityOption === "1";
    const calibratedOption = url.searchParams.get("calibrated") || "0";
    if (!["0", "1"].includes(calibratedOption))
      throw new RequestError("calibrated 只能是 0 或 1");
    const calibrated = calibratedOption === "1";
    const suffix = url.searchParams.get("record_suffix") || "1";
    if (!/^(?:[1-9]|1[0-9]|20)$/.test(suffix))
      throw new RequestError("record_suffix 必须是 1–20 的整数");
    let sourceFile: string | undefined;
    const exclude = parseExcludeParam(url.searchParams.get("exclude"));
    const ctype = request.headers.get("content-type") || "";
    let bytes = await readLimited(request, MAX_FILE);
    if (ctype.toLowerCase().includes("multipart/form-data")) {
      let form: FormData;
      try {
        form = await new Response(bytes, {
          headers: { "Content-Type": ctype },
        }).formData();
      } catch {
        throw new RequestError("无效的 multipart/form-data 表单或 boundary");
      }
      const file = form.get("file");
      if (
        !file ||
        typeof file === "string" ||
        typeof file.arrayBuffer !== "function"
      )
        throw new RequestError("表单缺少有效的 file 文件字段");
      if (includeIdentity && "name" in file && typeof file.name === "string")
        sourceFile = file.name;
      bytes = new Uint8Array(await file.arrayBuffer());
    }
    if (bytes.length < 50) throw new RequestError("上传文件为空或无效");
    if (!(
      (bytes[0] === 37 &&
        bytes[1] === 80 &&
        bytes[2] === 68 &&
        bytes[3] === 70) ||
      (bytes[0] === 137 &&
        bytes[1] === 80 &&
        bytes[2] === 78 &&
        bytes[3] === 71) ||
      (bytes[0] === 255 && bytes[1] === 216)
    ))
      throw new RequestError(
        "上传文件不是 PDF、PNG 或 JPEG（未检测到 %PDF/图片标识）",
      );
    const rec = await loadRecording(bytes);
    if (suffix !== "1") rec.record_id += "_" + suffix;
    if (sourceFile) rec.identity.source_file = sourceFile;
    const result = analyze(rec, exclude, sex as Sex, placement as Placement);
    if (format === "csv")
      return new Response(signalCsv(rec, result), {
        headers: {
          ...HEADERS,
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${rec.record_id}_signal.csv"`,
        },
      });
    const svg =
      format === "svg" || svgOption !== "0"
        ? renderDashboardSvg(rec, result, includeIdentity, calibrated)
        : undefined;
    if (format === "svg")
      return new Response(svg, {
        headers: { ...HEADERS, "Content-Type": "image/svg+xml; charset=utf-8" },
      });
    return Response.json(
      {
        code: 0,
        schema_version: "1.1",
        ...result.report,
        ...(includeIdentity ? { identity: rec.identity } : {}),
        assessment: assessment(result.report),
        summary: summaryRow(result.report, sourceFile),
        calibrated,
        coverage: {
          sampling_rate_hz: rec.fs,
          samples: rec.t.length,
          start_s: rec.t[0],
          end_s: rec.t[rec.t.length - 1],
          rows: rec.rows.length,
        },
        svg,
      },
      { headers: HEADERS },
    );
  } catch (err) {
    const status =
      err instanceof RequestError
        ? err.status
        : err instanceof AnalysisError
          ? 422
          : 500;
    const message =
      err instanceof RequestError || err instanceof AnalysisError
        ? err.message
        : "分析服务内部错误，请稍后重试";
    return format === "json"
      ? Response.json(
          { code: status, error: message },
          { status, headers: HEADERS },
        )
      : new Response(`分析失败: ${message}`, {
          status,
          headers: { ...HEADERS, "Content-Type": "text/plain; charset=utf-8" },
        });
  }
};
