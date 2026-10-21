/** Copyright (C) 2026 Chizukuo. SPDX-License-Identifier: GPL-3.0-or-later */
let selectedFile = null;
let selectedFiles = [];
let batchReports = [];
let activeRequest = null;
let analyzedRequest = null;
let currentJsonData = null;
let currentSvgData = null;
let currentScale = 1.0;

// Theme Manager
function initTheme() {
  let saved = "light";
  try {
    saved = localStorage.getItem("app-theme") || "light";
  } catch {}
  applyTheme(saved);
}
function toggleTheme() {
  const cur = document.documentElement.getAttribute("data-theme");
  const next = cur === "dark" ? "light" : "dark";
  applyTheme(next);
  try {
    localStorage.setItem("app-theme", next);
  } catch {}
}
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  const iconSun = document.getElementById("theme-icon-sun");
  const iconMoon = document.getElementById("theme-icon-moon");
  if (theme === "dark") {
    iconSun.style.display = "block";
    iconMoon.style.display = "none";
  } else {
    iconSun.style.display = "none";
    iconMoon.style.display = "block";
  }
}
initTheme();

// Init Endpoint URL
window.addEventListener("DOMContentLoaded", () => {
  const el = document.getElementById("shortcut-api-url");
  if (el) {
    const origin = window.location.origin.startsWith("http")
      ? window.location.origin
      : "https://ecg.chizunet.cc";
    el.innerText = origin + "/api/analyze?format=svg";
  }
});

// File Drop Handlers & Window Drag Prevention
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => e.preventDefault());

const dropzone = document.getElementById("dropzone");
dropzone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropzone.classList.add("dragover");
});
dropzone.addEventListener("dragleave", () =>
  dropzone.classList.remove("dragover"),
);
dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropzone.classList.remove("dragover");
  if (e.dataTransfer.files.length > 0) handleFileSelect(e.dataTransfer.files);
});

function handleFileSelect(input) {
  const files = input instanceof File ? [input] : Array.from(input || []);
  if (!files.length) return;
  if (files.length > 20) {
    alert("一次最多分析 20 份记录");
    return;
  }
  if (files.some((file) => file.size > 15 * 1024 * 1024)) {
    alert("每份文件不得超过 15 MB");
    return;
  }
  activeRequest?.abort();
  selectedFiles = files;
  selectedFile = files[0];
  batchReports = [];
  currentJsonData = null;
  currentSvgData = null;
  analyzedRequest = null;
  document.getElementById("result-view").style.display = "none";
  document.getElementById("batch-results").hidden = true;
  document.getElementById("file-label").innerHTML =
    `已选择: <b>${escapeHtml(selectedFile.name)}</b>${files.length > 1 ? ` 等 ${files.length} 份记录` : ""}`;
  document.getElementById("btn-submit").disabled = false;
}

// Canvas Viewport Mouse Drag-to-Pan
const canvasViewport = document.getElementById("canvas-viewport");
let isPanning = false;
let panStartX = 0,
  panStartY = 0;
let scrollStartX = 0,
  scrollStartY = 0;

if (canvasViewport) {
  canvasViewport.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    isPanning = true;
    canvasViewport.classList.add("is-panning");
    panStartX = e.pageX - canvasViewport.offsetLeft;
    panStartY = e.pageY - canvasViewport.offsetTop;
    scrollStartX = canvasViewport.scrollLeft;
    scrollStartY = canvasViewport.scrollTop;
  });

  window.addEventListener("mousemove", (e) => {
    if (!isPanning || !canvasViewport) return;
    e.preventDefault();
    const x = e.pageX - canvasViewport.offsetLeft;
    const y = e.pageY - canvasViewport.offsetTop;
    canvasViewport.scrollLeft = scrollStartX - (x - panStartX);
    canvasViewport.scrollTop = scrollStartY - (y - panStartY);
  });

  window.addEventListener("mouseup", () => {
    if (isPanning) {
      isPanning = false;
      if (canvasViewport) canvasViewport.classList.remove("is-panning");
    }
  });
}

async function loadDemoSample(e) {
  if (e && e.stopPropagation) e.stopPropagation();
  try {
    showToast("正在载入合成示例...");
    const res = await fetch("/sample_ecg.pdf");
    if (!res.ok) throw new Error("未能读取到示例文件");
    const blob = await res.blob();
    const file = new File([blob], "Apple_Watch_ECG_Demo.pdf", {
      type: "application/pdf",
    });
    handleFileSelect(file);
    await submitAnalysis();
  } catch (err) {
    alert("载入示例失败: " + err.message);
  }
}

async function submitAnalysis(e) {
  if (e && e.stopPropagation) e.stopPropagation();
  if (!selectedFile) return;

  activeRequest?.abort();
  const controller = new AbortController();
  activeRequest = controller;
  const files = [...selectedFiles];
  batchReports = [];
  const params = new URLSearchParams({
    format: "json",
    sex: document.getElementById("sex").value,
    placement: document.getElementById("placement").value,
    exclude: document.getElementById("exclude").value,
    include_identity: document.getElementById("include-identity").checked
      ? "1"
      : "0",
    calibrated: document.getElementById("calibrated").checked ? "1" : "0",
  });
  const btnSubmit = document.getElementById("btn-submit");
  const loading = document.getElementById("loading-indicator");
  const resultView = document.getElementById("result-view");

  btnSubmit.disabled = true;
  loading.style.display = "block";
  resultView.style.display = "none";

  try {
    if (files.length > 1 && params.get("exclude"))
      throw new Error("批量分析不接受手动排除时段，请单独分析该文件");
    const usedIds = new Map();
    for (const file of files) {
      if (controller.signal.aborted) return;
      const formData = new FormData();
      formData.append("file", file);
      let res = await fetch("/api/analyze?" + params, {
        method: "POST",
        body: formData,
        signal: controller.signal,
      });
      let data = await res.json();
      if (activeRequest !== controller || controller.signal.aborted) return;
      if (!res.ok) {
        if (files.length === 1) throw new Error(data.error || "服务器分析异常");
        batchReports.push({
          error: data.error || "无法分析",
          index: batchReports.length + 1,
        });
        continue;
      }
      const requestParams = new URLSearchParams(params);
      const count = (usedIds.get(data.record_id) || 0) + 1;
      usedIds.set(data.record_id, count);
      if (count > 1) {
        requestParams.set("record_suffix", String(count));
        res = await fetch("/api/analyze?" + requestParams, {
          method: "POST",
          body: formData,
          signal: controller.signal,
        });
        data = await res.json();
        if (activeRequest !== controller || controller.signal.aborted) return;
        if (!res.ok) {
          batchReports.push({ error: data.error || "无法分析" });
          continue;
        }
      }
      batchReports.push({
        report: data,
        request: { file, params: requestParams.toString() },
      });
    }
    const first = batchReports.findIndex((entry) => entry.report);
    if (first >= 0) showBatchRecord(first);
    if (files.length > 1) renderBatchList();
  } catch (err) {
    if (err.name !== "AbortError") alert("分析失败: " + err.message);
  } finally {
    if (activeRequest === controller) {
      loading.style.display = "none";
      btnSubmit.disabled = false;
      activeRequest = null;
    }
  }
}

function showBatchRecord(index) {
  const entry = batchReports[index];
  if (!entry?.report) return;
  analyzedRequest = entry.request;
  currentJsonData = entry.report;
  currentSvgData = entry.report.svg;
  renderResults(entry.report);
}
function renderBatchList() {
  const container = document.getElementById("batch-list");
  container.replaceChildren();
  batchReports.forEach((entry, index) => {
    const button = document.createElement("button");
    button.className = "btn btn-secondary";
    button.textContent = entry.report
      ? `${index + 1}. ${entry.report.record_id} · ${entry.report.rhythm.hr_bpm} bpm`
      : `${index + 1}. ${entry.error}`;
    button.disabled = !entry.report;
    button.onclick = () => showBatchRecord(index);
    container.appendChild(button);
  });
  document.getElementById("batch-results").hidden = false;
}
function downloadSummary() {
  const reports = batchReports
    .filter((entry) => entry.report)
    .map((entry) => entry.report)
    .sort((a, b) =>
      (a.watch.recorded_at || "").localeCompare(b.watch.recorded_at || ""),
    );
  if (!reports.length) return;
  const rows = reports.map((rep) => rep.summary);
  // Quote all fields and prevent spreadsheet formula execution in untrusted metadata.
  const csvCell = (value) => {
    let text =
      value == null
        ? ""
        : typeof value === "boolean"
          ? value
            ? "True"
            : "False"
          : String(value);
    if (typeof value === "string" && /^[=+@\-\t\r]/.test(text))
      text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  };
  const csv =
    "\ufeff" +
    [Object.keys(rows[0]), ...rows.map(Object.values)]
      .map((row) => row.map(csvCell).join(","))
      .join("\r\n") +
    "\r\n";
  const a = document.createElement("a");
  a.href = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
  );
  a.download = "summary.csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function renderResults(data) {
  const resultView = document.getElementById("result-view");
  resultView.style.display = "block";

  const w = data.watch || {};
  const id = data.identity || {};
  const rh = data.rhythm || {};
  const mo = data.morphology || {};
  const hv = data.hrv || {};
  const flags = [
    ...(data.flags || []),
    ...(data.morphology_alerts?.skipped || []),
    ...(data.notes || []),
  ];

  // 1. Patient Metadata Strip
  document.getElementById("meta-name").innerText =
    id.name || data.record_id || "心电图记录";
  document.getElementById("meta-age").innerText =
    w.age_at_recording != null
      ? `${w.age_at_recording} 岁`
      : id.dob
        ? `出生 ${id.dob}`
        : "未注明";
  document.getElementById("meta-time").innerText = w.recorded_at || "未注明";
  document.getElementById("meta-watch-bpm").innerText = w.reported_bpm
    ? `${w.reported_bpm} bpm`
    : "—";

  // 2. Severity Badge
  const statusBadge = document.getElementById("status-badge");
  const evaluation = data.assessment;
  statusBadge.className =
    "badge " +
    (evaluation.status === "urgent"
      ? "badge-alert"
      : evaluation.status === "normal"
        ? "badge-ok"
        : "badge-warn");
  statusBadge.innerText = evaluation.title;

  // 3. Telemetry Cell Values (Immediate, zero artificial delay)
  document.getElementById("val-hr").innerText = rh.hr_bpm
    ? rh.hr_bpm.toFixed(1)
    : "—";
  document.getElementById("sub-rr").innerText =
    `RR ${rh.rr_ms_min ?? "—"}–${rh.rr_ms_max ?? "—"} ms`;
  const tagHr = document.getElementById("tag-hr");
  if (rh.hr_bpm == null) {
    tagHr.className = "cell-status";
    tagHr.innerText = "未测出";
  } else if (rh.hr_bpm < 50) {
    tagHr.className = "cell-status badge-warn";
    tagHr.innerText = "心动过缓 (<50)";
  } else if (rh.hr_bpm > 100) {
    tagHr.className = "cell-status badge-warn";
    tagHr.innerText = "心动过速 (>100)";
  } else {
    tagHr.className = "cell-status badge-ok";
    tagHr.innerText = "50–100 正常";
  }

  document.getElementById("val-qrs").innerText = mo.qrs_ms ?? "—";
  applyEvaluation("tag-qrs", evaluation.qrs);
  document.getElementById("val-qtc").innerText = evaluation.qtc.value ?? "—";
  document.getElementById("sub-qt").innerText =
    `采用 ${evaluation.qtc.formula} · QT ${mo.qt_ms ?? "—"} ms · B ${mo.qtc_bazett_ms ?? "—"} / F ${mo.qtc_fridericia_ms ?? "—"}`;
  applyEvaluation("tag-qtc", evaluation.qtc);
  document.getElementById("val-pr").innerText = mo.pr_ms ?? "—";
  applyEvaluation("tag-pr", evaluation.pr);

  document.getElementById("val-rmssd").innerText =
    hv.rmssd_ms != null ? hv.rmssd_ms.toFixed(1) : "—";
  document.getElementById("sub-hrv").innerText =
    `SDNN ${hv.sdnn_ms ?? "—"} ms · pNN50 ${hv.pnn50_pct ?? "—"}%`;

  const nEctopic = evaluation.premature;
  document.getElementById("val-ectopic").innerText = nEctopic;
  document.getElementById("sub-ectopic").innerText =
    `同形 ${rh.n_premature_same || 0} · 异形 ${rh.n_premature_diff || 0} · 异常 ${rh.n_odd || 0}`;
  const tagEctopic = document.getElementById("tag-ectopic");
  if (nEctopic > 0) {
    tagEctopic.className = "cell-status badge-warn";
    tagEctopic.innerText = `检出 ${nEctopic} 拍早搏`;
  } else {
    tagEctopic.className = "cell-status badge-ok";
    tagEctopic.innerText = "未见早搏";
  }

  // 4. Inject SVG
  document.getElementById("svg-output").innerHTML = data.svg;
  resetCanvasZoom();

  // 5. Findings List
  const findingsContainer = document.getElementById("findings-list");
  if (flags && flags.length > 0) {
    findingsContainer.innerHTML = flags
      .map((f) => {
        const isW = f.includes("22 岁以下") || f.includes("相差");
        return `<div class="finding-row ${isW ? "flag-warning" : ""}"><div>${escapeHtml(f)}</div></div>`;
      })
      .join("");
  } else {
    findingsContainer.innerHTML = `<div class="finding-row flag-ok"><div>基线平稳，未检出异位早搏、长间歇停顿或形态学异常警报。</div></div>`;
  }

  resultView.scrollIntoView({ behavior: "smooth" });
}

// Viewport Controls
const baseCanvasWidth = 1200;

function zoomCanvas(factor) {
  currentScale = Math.min(2.5, Math.max(0.6, currentScale * factor));
  applyCanvasZoom();
}
function resetCanvasZoom() {
  currentScale = 1.0;
  applyCanvasZoom();
}
function applyCanvasZoom() {
  const svg = document.querySelector("#svg-output svg");
  const levelEl = document.getElementById("zoom-level");
  if (levelEl) levelEl.innerText = `${Math.round(currentScale * 100)}%`;
  if (svg) {
    if (currentScale === 1.0) {
      svg.style.width = "100%";
      svg.style.maxWidth = "100%";
      svg.style.minWidth = "800px";
    } else {
      const newW = Math.round(baseCanvasWidth * currentScale);
      svg.style.width = `${newW}px`;
      svg.style.maxWidth = "none";
      svg.style.minWidth = `${newW}px`;
    }
  }
}
function scrollToSection(type) {
  const viewport = document.getElementById("canvas-viewport");
  if (!viewport) return;
  const scale = currentScale || 1.0;
  if (type === "template") {
    viewport.scrollTo({
      top: Math.round(480 * scale),
      left: 0,
      behavior: "smooth",
    });
  } else if (type === "poincare") {
    viewport.scrollTo({
      top: Math.round(480 * scale),
      left: Math.round(768 * scale),
      behavior: "smooth",
    });
  }
}

// Exports
function downloadSvg() {
  if (!currentSvgData) return;
  const blob = new Blob([currentSvgData], {
    type: "image/svg+xml;charset=utf-8",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = (currentJsonData?.record_id || "ecg") + "_dashboard.svg";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  showToast("已下载矢量 SVG");
}

function exportPng() {
  if (!currentSvgData) return;
  const recordId = currentJsonData?.record_id || "ecg";
  showToast("正在渲染高分辨率 PNG...");

  const parser = new DOMParser();
  const doc = parser.parseFromString(currentSvgData, "image/svg+xml");
  const svgEl = doc.documentElement;
  const viewBox = svgEl.getAttribute("viewBox")?.split(" ").map(Number);
  const w = viewBox ? viewBox[2] : 1200;
  const h = viewBox ? viewBox[3] : 850;

  const scale = 2; // 2x Retina Clarity
  const canvas = document.createElement("canvas");
  canvas.width = w * scale;
  canvas.height = h * scale;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const img = new Image();
  svgEl.setAttribute("width", String(w));
  svgEl.setAttribute("height", String(h));
  const svgBlob = new Blob([new XMLSerializer().serializeToString(svgEl)], {
    type: "image/svg+xml;charset=utf-8",
  });
  const url = URL.createObjectURL(svgBlob);

  img.onload = () => {
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    const pngUrl = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = pngUrl;
    a.download = recordId + "_dashboard.png";
    a.click();
    showToast("已导出 PNG 图片");
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    showToast("PNG 渲染失败，请导出 SVG");
  };
  img.src = url;
}

function downloadJson() {
  if (!currentJsonData) return;
  const { svg, code, ...report } = currentJsonData;
  const blob = new Blob([JSON.stringify(report, null, 2)], {
    type: "application/json",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = (currentJsonData?.record_id || "ecg") + "_report.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  showToast("已导出 JSON 报告");
}

function applyEvaluation(id, result) {
  const el = document.getElementById(id);
  el.className =
    "cell-status " +
    (result.status === "normal"
      ? "badge-ok"
      : result.status === "urgent"
        ? "badge-alert"
        : "badge-warn");
  el.innerText = {
    normal: "已评估，未触发提醒",
    attention: "关注",
    urgent: "建议就医",
    unreliable: "不可靠 / 未评估",
    unavailable: "未测量",
  }[result.status];
  el.title = result.reason;
}

async function downloadCsv() {
  if (!analyzedRequest) return;
  const recordId = currentJsonData.record_id;
  const params = new URLSearchParams(analyzedRequest.params);
  params.set("format", "csv");
  const form = new FormData();
  form.append("file", analyzedRequest.file);
  try {
    const response = await fetch("/api/analyze?" + params, {
      method: "POST",
      body: form,
    });
    if (!response.ok) throw new Error(await response.text());
    const url = URL.createObjectURL(await response.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = recordId + "_signal.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (err) {
    alert("CSV 导出失败: " + err.message);
  }
}

function copyApiUrl() {
  const text = document.getElementById("shortcut-api-url").innerText;
  const btn = document.getElementById("copy-btn");
  navigator.clipboard
    .writeText(text)
    .then(() => {
      btn.innerText = "已复制";
      setTimeout(() => (btn.innerText = "复制地址"), 2000);
      showToast("已复制 API 接口地址");
    })
    .catch(() => {
      const input = document.createElement("input");
      input.value = text;
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      document.body.removeChild(input);
      showToast("已复制 API 接口地址");
    });
}

function showToast(msg) {
  const toast = document.getElementById("toast-msg");
  toast.innerText = msg;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2400);
}

function escapeHtml(text) {
  if (!text) return "";
  return text.replace(
    /[&<>"']/g,
    (m) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[m],
  );
}

window.addEventListener("beforeprint", () => {
  const output = document.getElementById("print-output");
  output.replaceChildren();
  if (currentSvgData) {
    const doc = new DOMParser().parseFromString(
      currentSvgData,
      "image/svg+xml",
    );
    output.appendChild(document.importNode(doc.documentElement, true));
  }
});
