# SPDX-License-Identifier: GPL-3.0-or-later
"""
End-to-End Parity Test Suite for Apple Watch ECG Web API
Using the Python project's testing methodology and synthetic generator (synth.py)
Tests against the local Cloudflare Pages API (http://127.0.0.1:8788/api/analyze)
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
import pytest
import requests

# Link to Python project dynamically
PY_PROJECT = Path(os.environ.get("APPLE_WATCH_ECG_PY_DIR", Path(__file__).resolve().parent.parent.parent / "apple_watch_ecg"))
if not PY_PROJECT.exists():
    PY_PROJECT = Path(r"c:\Users\27232\Documents\apple_watch_ecg")

sys.path.insert(0, str(PY_PROJECT))
sys.path.insert(0, str(PY_PROJECT / "tests"))

import apple_watch_ecg as A
from synth import (
    add_motion_artifact,
    build_apple_like_pdf,
    make_beats,
    make_rsa_beats,
    synth_signal,
    waves_variant,
)

API_URL = os.environ.get("API_URL", "http://127.0.0.1:8788/api/analyze")
HEALTH_URL = os.environ.get("HEALTH_URL", "http://127.0.0.1:8788/api/health")
FAKE_FILE = "健康 - 测试用户 - 心电图2026-10-13 11.25.pdf"


def is_web_api_running() -> bool:
    try:
        r = requests.get(HEALTH_URL, timeout=1.0)
        return r.status_code == 200
    except Exception:
        return False


pytestmark = pytest.mark.skipif(
    not is_web_api_running(),
    reason="Web API is not running on http://127.0.0.1:8788. Start with npm run dev (or npx wrangler pages dev public)."
)


def make_pdf(tmp_path: Path, name=FAKE_FILE, beats=None, hr=72.0, events=None, alt=None, **pdf_kw):
    beats = beats or make_beats(hr=hr, events=events, alt=alt)
    t, v = synth_signal(beats)
    path = tmp_path / name
    pdf_kw.setdefault("bpm", round(60 * (len(beats) - 1) / (beats[-1][0] - beats[0][0])))
    build_apple_like_pdf(path, t, v, **pdf_kw)
    return path, beats


def post_to_web(path: Path, format="json", params=None) -> tuple[int, dict | str]:
    with open(path, "rb") as f:
        pdf_bytes = f.read()
    url = f"{API_URL}?format={format}"
    resp = requests.post(url, data=pdf_bytes, params=params, headers={"Content-Type": "application/pdf"})
    if format == "json":
        return resp.status_code, resp.json()
    return resp.status_code, resp.text


# ---------------------------------------------------------------------------
# 1. 正常窦性心律测试 (Normal Sinus Roundtrip)
# ---------------------------------------------------------------------------
def test_web_sinus_roundtrip(tmp_path):
    path, beats = make_pdf(tmp_path)
    rec = A.load(path)
    py_res = A.analyze(rec)
    py_rep = py_res["report"]

    status, web_res = post_to_web(path, format="json")
    assert status == 200, f"Web API failed: {web_res}"
    assert web_res["code"] == 0

    assert web_res["record_id"] == "ECG_20261013_1125"
    assert web_res["watch"]["classification"] == "窦性心律"
    assert web_res["watch"]["reported_bpm"] == 72

    # Heart rate & beat count
    rh = web_res["rhythm"]
    assert rh["beats"] == len(beats)
    assert abs(rh["hr_bpm"] - py_rep["rhythm"]["hr_bpm"]) < 0.1
    assert abs(rh["hr_bpm"] - 72.0) < 0.6
    assert rh["n_normal"] == len(beats)
    assert rh["n_premature_same"] == 0
    assert rh["n_premature_diff"] == 0
    assert rh["n_odd"] == 0

    # HRV metrics
    hv = web_res["hrv"]
    assert abs(hv["rmssd_ms"] - py_rep["hrv"]["rmssd_ms"]) < 0.2
    assert abs(hv["sdnn_ms"] - py_rep["hrv"]["sdnn_ms"]) < 0.2

    # Morphology
    mo = web_res["morphology"]
    assert mo["p_measurable"] is True
    assert mo["p_polarity"] == "直立"
    assert abs(mo["r_amp_mv"] - py_rep["morphology"]["r_amp_mv"]) < 0.05
    assert abs(mo["t_amp_mv"] - py_rep["morphology"]["t_amp_mv"]) < 0.05
    assert abs(mo["qrs_ms"] - py_rep["morphology"]["qrs_ms"]) <= 2.0
    assert abs(mo["qt_ms"] - py_rep["morphology"]["qt_ms"]) <= 4.0

    # SVG check
    assert "<svg" in web_res["svg"]
    assert "</svg>" in web_res["svg"]
    assert "窦性心律" in web_res["svg"]


# ---------------------------------------------------------------------------
# 2. 多心率跨行边界测试 (Boundary & Heart Rate Variations)
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("hr", [55, 68, 83, 97, 118])
def test_web_row_boundaries_no_false_or_missed_beats(tmp_path, hr):
    path, beats = make_pdf(tmp_path, hr=hr, label="窦性心律" if hr < 100 else "高心率")
    rec = A.load(path)
    py_res = A.analyze(rec)

    status, web_res = post_to_web(path, format="json")
    assert status == 200
    assert web_res["rhythm"]["beats"] == len(beats)
    assert web_res["rhythm"]["beats"] == py_res["report"]["rhythm"]["beats"]
    assert abs(web_res["rhythm"]["hr_bpm"] - py_res["report"]["rhythm"]["hr_bpm"]) < 0.2
    assert web_res["rhythm"]["n_normal"] == len(beats)
    assert web_res["rhythm"]["n_premature_same"] == 0
    assert web_res["rhythm"]["n_premature_diff"] == 0


# ---------------------------------------------------------------------------
# 3. 室性早搏识别测试 (Ventricular Premature Beats V & W)
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("kind", ["V", "W"])
def test_web_ventricular_premature_beat(tmp_path, kind):
    path, beats = make_pdf(tmp_path, events={8: kind})
    rec = A.load(path)
    py_res = A.analyze(rec)

    status, web_res = post_to_web(path, format="json")
    assert status == 200

    rh = web_res["rhythm"]
    py_rh = py_res["report"]["rhythm"]
    assert rh["n_premature_diff"] == 1
    assert rh["n_premature_diff"] == py_rh["n_premature_diff"]
    assert rh["n_premature_same"] == 0
    assert not rh["pauses"]  # Compensatory pause must NOT be reported as pause
    assert any("室性早搏" in f for f in web_res["flags"])


# ---------------------------------------------------------------------------
# 4. 房性早搏识别测试 (Atrial Premature Beat A)
# ---------------------------------------------------------------------------
def test_web_atrial_premature_beat(tmp_path):
    path, beats = make_pdf(tmp_path, events={8: "A"})
    rec = A.load(path)
    py_res = A.analyze(rec)

    status, web_res = post_to_web(path, format="json")
    assert status == 200

    rh = web_res["rhythm"]
    py_rh = py_res["report"]["rhythm"]
    assert rh["n_premature_same"] == 1
    assert rh["n_premature_same"] == py_rh["n_premature_same"]
    assert rh["n_premature_diff"] == 0


# ---------------------------------------------------------------------------
# 5. 二联律识别与排他测试 (Bigeminy Pattern)
# ---------------------------------------------------------------------------
def test_web_bigeminy_pattern(tmp_path):
    # 4 PVCs alternating with sinus beats (Bigeminy)
    path, _ = make_pdf(tmp_path, events={6: "V", 7: "V", 8: "V", 9: "V"})
    status, web_res = post_to_web(path, format="json")
    assert status == 200
    assert web_res["rhythm"]["n_premature_diff"] == 4
    assert web_res["rhythm"]["bigeminy_start_s"] is not None

    # Trigeminy (not bigeminy)
    path3, _ = make_pdf(tmp_path, name="tri.pdf", events={6: "V", 8: "V", 10: "V"})
    status3, web_res3 = post_to_web(path3, format="json")
    assert status3 == 200
    assert web_res3["rhythm"]["n_premature_diff"] == 3
    assert web_res3["rhythm"]["bigeminy_start_s"] is None


# ---------------------------------------------------------------------------
# 6. 真实窦性停搏识别测试 (True Sinus Pause)
# ---------------------------------------------------------------------------
def test_web_sinus_pause(tmp_path):
    path, _ = make_pdf(tmp_path, events={10: "pause"})
    rec = A.load(path)
    py_res = A.analyze(rec)

    status, web_res = post_to_web(path, format="json")
    assert status == 200

    rh = web_res["rhythm"]
    assert len(rh["pauses"]) == 1
    assert rh["pauses"][0]["ratio"] > 1.9
    assert rh["n_premature_same"] == 0
    assert rh["n_premature_diff"] == 0
    assert any("长间歇" in f for f in web_res["flags"])


# ---------------------------------------------------------------------------
# 7. RR 长短交替测试 (RR Alternation)
# ---------------------------------------------------------------------------
def test_web_rr_alternation(tmp_path):
    path, _ = make_pdf(tmp_path, alt=(4, 20))
    rec = A.load(path)
    py_res = A.analyze(rec)

    status, web_res = post_to_web(path, format="json")
    assert status == 200

    rh = web_res["rhythm"]
    assert rh["rr_alternation_start_s"]
    assert rh["n_premature_same"] == 0
    assert rh["n_premature_diff"] == 0


# ---------------------------------------------------------------------------
# 8. 呼吸性窦性心律不齐测试 (RSA is not premature)
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("hr", [70, 95, 125])
def test_web_rsa_is_not_premature(tmp_path, hr):
    beats = make_rsa_beats(hr=hr, depth=0.15)
    path, _ = make_pdf(tmp_path, beats=beats, label="窦性心律" if hr < 100 else "高心率", bpm=hr)
    status, web_res = post_to_web(path, format="json")
    assert status == 200
    assert web_res["rhythm"]["beats"] == len(beats)
    assert web_res["rhythm"]["n_premature_same"] == 0
    assert web_res["rhythm"]["n_premature_diff"] == 0
    assert not web_res["rhythm"]["pauses"]


# ---------------------------------------------------------------------------
# 9. 运动伪影自动剔除测试 (Motion Artifact Detection)
# ---------------------------------------------------------------------------
def test_web_motion_artifact_excluded(tmp_path):
    beats = make_beats(hr=72)
    t, v = synth_signal(beats)
    v = add_motion_artifact(t, v, at=14.0)
    path = tmp_path / "artifact.pdf"
    build_apple_like_pdf(path, t, v, bpm=72)

    status, web_res = post_to_web(path, format="json")
    assert status == 200

    rep = web_res
    assert rep["quality"]["artifact_windows_s"]
    a0, a1 = rep["quality"]["artifact_windows_s"][0]
    assert a0 <= 14.0 <= a1
    assert not rep["rhythm"]["pauses"]


# ---------------------------------------------------------------------------
# 10. 年龄与症状元数据提取测试 (Metadata Flags)
# ---------------------------------------------------------------------------
def test_web_pdf_metadata_flags(tmp_path):
    path, _ = make_pdf(tmp_path, symptoms="心悸", dob="2006年1月1日", age=20)
    status, web_res = post_to_web(path, format="json")
    assert status == 200

    w = web_res["watch"]
    assert w["recorded_at"] == "2026-10-13 11:25"
    assert w["age_at_recording"] == 20
    assert w["category"] == "sinus"
    assert w["symptoms"] == "心悸"

    flags = web_res["flags"]
    assert any("22 岁以下" in f for f in flags)
    assert any("心悸" in f for f in flags)


# ---------------------------------------------------------------------------
# 11. 手表分类一致性与差异报警测试 (Watch Consistency)
# ---------------------------------------------------------------------------
def test_web_watch_classification_inconsistency(tmp_path):
    path, _ = make_pdf(tmp_path, hr=120, label="窦性心律", bpm=72)
    status, web_res = post_to_web(path, format="json")
    assert status == 200

    flags = web_res["flags"]
    assert any("相差超过 3 次/分" in f for f in flags)
    assert any("对应 50–99 次/分" in f for f in flags)


# ---------------------------------------------------------------------------
# 12. 真实真机 PDF 验证测试 (Real Hardware PDF Validation)
# ---------------------------------------------------------------------------
def test_web_real_user_pdf():
    real_pdf = Path(r"C:\Users\27232\Downloads\健康 - 黄麒文 - 心电图2026-10-18 13.33.pdf")
    if not real_pdf.exists():
        pytest.skip("Real PDF not found")

    rec = A.load(real_pdf)
    py_res = A.analyze(rec)
    py_rep = py_res["report"]

    status, web_res = post_to_web(real_pdf, format="json")
    assert status == 200
    assert web_res["code"] == 0

    assert web_res["identity"]["name"] == "黄麒文"
    assert web_res["identity"]["dob"] == "2005-10-19"
    assert web_res["watch"]["classification"] == "窦性心律"
    assert web_res["rhythm"]["beats"] == py_rep["rhythm"]["beats"]
    assert abs(web_res["rhythm"]["hr_bpm"] - py_rep["rhythm"]["hr_bpm"]) < 0.1
    assert web_res["rhythm"]["n_normal"] == py_rep["rhythm"]["n_normal"]
    assert web_res["rhythm"]["n_premature_same"] == py_rep["rhythm"]["n_premature_same"]
    assert web_res["rhythm"]["n_premature_diff"] == py_rep["rhythm"]["n_premature_diff"]

    # Verify SVG endpoint returns 200 and image/svg+xml
    svg_status, svg_text = post_to_web(real_pdf, format="svg")
    assert svg_status == 200
    assert svg_text.startswith("<svg")
    assert svg_text.endswith("</svg>")
    assert "黄麒文" in svg_text or "窦性心律" in svg_text
    assert "QRS 68 ms" in svg_text
    assert "QT 365 ms" in svg_text
