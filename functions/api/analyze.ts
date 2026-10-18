/**
 * Cloudflare Pages Function: /api/analyze
 * Full-stack Apple Watch ECG Analysis API for WebUI and iOS Shortcuts
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { parsePdf } from "../../src/core/pdf";
import { analyze } from "../../src/core/pipeline";
import { renderDashboardSvg } from "../../src/render/svg";
import { AnalysisError } from "../../src/core/types";

function parseExcludeParam(param: string | null): [number, number][] {
  if (!param) return [];
  const intervals: [number, number][] = [];
  const parts = param.split(",");
  for (const p of parts) {
    const segments = p.split("-");
    if (segments.length !== 2) continue;
    const a = parseFloat(segments[0]);
    const b = parseFloat(segments[1]);
    if (!isNaN(a) && !isNaN(b) && a >= 0 && b > a && b <= 300) {
      intervals.push([a, b]);
    }
  }
  return intervals;
}

function errorResponse(message: string, status: number, format: string): Response {
  if (format === "json") {
    return Response.json(
      { code: status, error: message },
      {
        status,
        headers: { "Access-Control-Allow-Origin": "*" },
      }
    );
  }
  return new Response(`分析失败: ${message}`, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

export const onRequestOptions: PagesFunction = async () => {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
};

export const onRequestPost: PagesFunction = async (context) => {
  const request = context.request;
  const url = new URL(request.url);
  const format = url.searchParams.get("format") || "svg";

  try {
    const contentLength = request.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > 15 * 1024 * 1024) {
      return errorResponse("文件过大（超过 15MB），请上传标准 Apple Watch 心电图 PDF", 413, format);
    }

    const ctype = request.headers.get("content-type") || "";
    let pdfBytes: Uint8Array;

    if (ctype.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      if (!file || typeof file === "string" || typeof (file as Blob).arrayBuffer !== "function") {
        return errorResponse("表单缺少有效的 file 文件字段", 400, format);
      }
      pdfBytes = new Uint8Array(await (file as Blob).arrayBuffer());
    } else {
      // Direct binary stream (native iOS Shortcuts mode)
      pdfBytes = new Uint8Array(await request.arrayBuffer());
    }

    if (pdfBytes.length < 50) {
      return errorResponse("上传文件为空或无效", 400, format);
    }

    if (pdfBytes.length > 15 * 1024 * 1024) {
      return errorResponse("文件过大（超过 15MB），请上传标准 Apple Watch 心电图 PDF", 413, format);
    }

    const isPdf =
      pdfBytes[0] === 0x25 &&
      pdfBytes[1] === 0x50 &&
      pdfBytes[2] === 0x44 &&
      pdfBytes[3] === 0x46;
    if (!isPdf) {
      return errorResponse("上传的文件不是有效的 PDF 文档（未检测到 %PDF 标识）", 400, format);
    }

    const sexParam = url.searchParams.get("sex") || "unknown";
    const sex = sexParam === "male" || sexParam === "female" ? sexParam : "unknown";
    const placementParam = url.searchParams.get("placement") || "wrist";
    const placement = placementParam === "other" ? "other" : "wrist";
    const manualExclude = parseExcludeParam(url.searchParams.get("exclude"));

    const rec = parsePdf(pdfBytes);
    const result = analyze(rec, manualExclude, sex, placement);
    const svg = renderDashboardSvg(rec, result);

    if (format === "json") {
      return Response.json(
        {
          code: 0,
          record_id: rec.record_id,
          watch: rec.watch,
          identity: rec.identity,
          rhythm: result.report.rhythm,
          hrv: result.report.hrv,
          morphology: result.report.morphology,
          morphology_alerts: result.report.morphology_alerts,
          quality: result.report.quality,
          flags: result.report.flags,
          notes: result.report.notes,
          beats: result.report.beats,
          svg,
        },
        {
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "no-store",
          },
        }
      );
    }

    return new Response(svg, {
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
      },
    });
  } catch (err: unknown) {
    const status = err instanceof AnalysisError ? 422 : 500;
    const errorMsg = err instanceof Error ? err.message : String(err);
    return errorResponse(errorMsg, status, format);
  }
};

