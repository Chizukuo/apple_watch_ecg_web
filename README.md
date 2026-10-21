# apple_watch_ecg_web

将 Apple Watch 心电图 PDF 或截图还原为连续波形，提供逐拍标注、HRV、平均心搏测量、形态提醒及可导出的报告。部署在 Cloudflare Pages Functions；浏览器页面和 iOS 快捷指令调用同一个 API。

**仅供个人记录与对比，不是医疗诊断或医疗器械。** 单导联与约 30 秒记录的限制同样适用于网页版；没有提醒不代表已排除疾病，未测出或不可靠的项目会单独说明。

## Python 基准与对齐范围

算法来自 [Chizukuo/apple_watch_ecg](https://github.com/Chizukuo/apple_watch_ecg)，当前独立验证固定在提交 `a7262bdbb271fd51960adf08004362885b3bc939`。两项目均使用 GPL-3.0-or-later。

- 连续拼接、基线与伪影识别、QRS/补检/高大 T 波抑制、逐拍分类、长间歇和二联律。
- NN/HRV、PQ/TP 双基线平均心搏、P/PR/QRS/ST/T/QT、Bazett 和 Fridericia、原版形态提醒和跳过规则。
- 支持性别阈值、非手腕位置、手动排除、默认身份隐藏、连续信号 CSV 和按记录时间排序的批量 summary.csv。
- PDF 按当前页面引用的内容流顺序解析；支持多内容流和对象流，忽略未引用旧内容。信号坐标按 PyMuPDF 的单精度语义处理。缺少完整三行记录时拒绝分析。
- PNG/JPEG 使用原版光栅追踪方法；扫描 PDF 支持单张完整页面图片的 8 位 RGB/灰度、Flate/PNG predictor 或 JPEG 编码。

CI 用 Python 现场生成合成 PDF，对照样本数量、逐拍表、节律、HRV、形态、质量、提醒及汇总字段；另有独立 SciPy/NeuroKit 滤波数值夹具和浏览器工作流检查。**这不代表任意输入均零误差，也不把 Python 的 MIT-BIH 指标当作已完成的 Web 外部验证。** 详细初始审查和修复验收见 [审查记录](audit/2026-10-21/REPORT.md) 与 [修复核对表](audit/2026-10-21/RESOLUTION.md)。

## 使用网页

生产入口：[ecg.chizunet.cc](https://ecg.chizunet.cc)。本 README 描述当前源码；生产是否已更新应以部署状态为准。

1. 上传 PDF、PNG 或 JPEG，或点击“载入合成示例”。内置示例是合成数据。
2. 选择性别阈值与记录位置；需要时填写排除时段，例如 `0-2,28-30`。非手腕记录跳过 ST/T 提醒。
3. 默认报告隐藏姓名、生日和源文件名；仅在主动勾选身份选项时保留。文件选择栏仍会显示你选择的本机文件名。
4. 支持缩放、SVG/PNG、JSON 和连续信号 CSV。JSON 下载保留完整报告及评估状态，不携带大段 SVG。
5. 一次最多选择 20 份记录，逐一分析，成功记录可切换查看并下载按采集时间排序的 summary.csv；失败记录单独显示。批量模式不接受手动排除，避免把同一排除段误用于不同记录。

QTc 单元使用后端实际选择的公式：心率 >100 使用 Fridericia，其余使用 Bazett。页面、SVG 和报告不会把“跳过评估”表述为全部正常。形态异常计数与提前搏动分开。

### 定标与打印

默认 SVG 自动缩放电压，按图中的秒/mV 坐标阅读。勾选“定标看板”后，波形区使用 25 mm/s ×10 mm/mV、1 mm 小格和 1 mV 方波，导出的 SVG 带物理毫米尺寸。超出绘图范围会注明，完整电压仍在 CSV。

浏览器打印采用 A4 横向、7 mm 页边距，只打印当前看板。定标打印应选择 **100% / 原始尺寸，关闭页眉页脚**，不要使用“适合页面”；屏幕缩放和 PNG 不保证实际毫米比例。请用定标方波核对纸面 1 mV 对应 10 mm。完整跳过原因和提示保存在 JSON 及页面说明中。

### iOS 快捷指令

[获取快捷指令](https://www.icloud.com/shortcuts/1eac247c7d264fc591c4db4239875277)。在健康 App 分享 ECG PDF 后，快捷指令以文件正文 POST 至 `/api/analyze?format=svg`，再通过“快速查看”预览返回的 SVG。已核对 2026-10-21 的公开流程，只有这两步，不包含自动存相册动作；可审查的 [动作定义与性能说明](shortcuts/README.md) 已收入仓库。现有快捷指令 URL 无需修改，服务更新后即可使用优化。API 也支持其他自动化客户端。

## API

`POST /api/analyze`，以 `multipart/form-data` 的 `file` 字段上传，或直接发送 PDF/PNG/JPEG 二进制。响应和错误均使用 `Cache-Control: no-store`；支持 CORS。`GET /api/health` 仅检查服务是否就绪，不证明算法通过验证。

| 参数 | 值及默认行为 |
|---|---|
| `format` | `svg`（默认）、`json`、`csv` |
| `sex` | `male` / `female` / `unknown`（默认）；未知按原版男性 QTc 阈值 |
| `placement` | `wrist`（默认）/ `other` |
| `exclude` | `0-2,28-30`；非负秒数，起点小于终点，终点不超过 300 |
| `include_identity` | `0`（默认）/ `1`，显式保留身份；表单文件名仅在此时进入报告 |
| `include_svg` | JSON 默认带 SVG；`0` 可省略 SVG 以减小响应 |
| `record_suffix` | 1–20；批量中同一分钟的重复 ID 使用 `_2` 等后缀，默认 1 不添加 |
| `calibrated` | `0`（默认自动缩放）/ `1`（定标 SVG） |

非法参数返回 400，超限上传返回 413，可读但无法完整分析的输入返回 422，内部错误返回不含底层详情的 500。分析接口 GET 返回 405。

```bash
curl -f -F "file=@记录.pdf" "http://127.0.0.1:8788/api/analyze?format=svg" -o dashboard.svg
curl -f --data-binary @记录.pdf "http://127.0.0.1:8788/api/analyze?format=json&include_svg=0" -o report.json
curl -f --data-binary @记录.pdf "http://127.0.0.1:8788/api/analyze?format=csv" -o signal.csv
```

```python
import requests

with open("记录.pdf", "rb") as f:
    res = requests.post(
        "http://127.0.0.1:8788/api/analyze",
        params={"format": "json", "sex": "unknown", "placement": "wrist", "include_svg": "0"},
        files={"file": f}, timeout=30,
    )
res.raise_for_status()
data = res.json()
print("心率:", data["rhythm"]["hr_bpm"])
print("QTc 评估:", data["assessment"]["qtc"])
if data["morphology"] is not None:
    print("QRS ms:", data["morphology"]["qrs_ms"])
for alert in data["morphology_alerts"]["alerts"]:
    print(alert["level"], alert["text"])
for reason in data["morphology_alerts"]["skipped"]:
    print("未评估:", reason)
```

### JSON 契约

- `code=0`、`schema_version=1.1`、`tool_version`、`source`、`record_id`。
- Python 报告对应字段：`watch/rhythm/hrv/morphology/morphology_alerts/quality/flags/notes/beats`。`morphology` 或测量值可为 null；不要把 null 当作正常或 0。
- `morphology_alerts` 保留原版的 sex、placement、alerts、skipped，并增加实际使用的 `qtc_formula`。
- `assessment` 提供前端统一状态、理由、QTc 公式及提前搏动计数；状态为 normal、attention、urgent、unavailable 或 unreliable。normal 仅表示已评估项目未触发提醒。
- `coverage` 提供 fs、样本数、覆盖起止秒数和行数；`summary` 为与 Python summary_row 对应的一行数据；`calibrated` 说明 SVG 模式。
- `identity` 默认完全缺失；主动开启才包含 name、dob 和可选 source_file。`svg` 可按参数省略。
- `watch.recorded_at` 保留 PDF 上的采集时间文字语义；`watch.exported_at` 统一为带 Z 的 UTC ISO 时间，避免边缘服务器时区改变结果。这是与 Python 本机时区显示的明确格式差异。
- CSV 列为 `time_s,voltage_mv,clipped,beat`，UTF-8 BOM。批量 summary.csv 对字符串做表格公式注入防护。

## 本地运行与验证

需要 Node.js ≥22.12（CI 检查 22、24）。单元测试和页面不需要 Python；独立对齐验证需要 Python ≥3.11，CI 使用 3.13。

```bash
npm ci
npm run build
npm test
npm run dev
```

默认本地地址为 `http://127.0.0.1:8788`。完整 Python 对照：

```bash
# 在同级目录检出 Python 项目，固定到上述基准提交
# 或设置 APPLE_WATCH_ECG_PY_DIR 指向其目录
python -m pip install -r ../apple_watch_ecg/requirements.txt pytest requests
npm run test:integration

# 浏览器验证会自动启动本地服务
npx playwright install chromium
npm run test:e2e
```

`test:integration` 启动自己的 Wrangler 实例和随机本地端口，等待 health 后运行 pytest，并在结束时关闭进程树。服务无法启动会失败，不会把全跳过视为成功。也可自行启动 `npm run dev` 后直接运行 `python -m pytest test/test_against_web_api.py test/test_alignment.py -q`。可选私人文件测试使用 `TEST_REAL_PDF_PATH`，不含硬编码身份或路径；默认跳过，不写入期望值。

依赖升级后重跑构建、单元测试、HTTP 对照和浏览器检查。`scripts/generate-dsp-reference.py` 可从独立 Python 库重新生成滤波夹具，生成版本记在夹具中。不要从 TS 实现生成它自己的期望结果。

## 输入限制与已知局限

- 每次请求体（含表单开销）最多 15 MiB，PDF 最多 8 页、4,096 个流、20,000 个对象，累计解压内容最多 32 MiB。图片最多 800 万像素。超过限制明确拒绝。
- 当前目标是完整三行约 30 秒的 Apple Watch 报告；不接受半张、加密 PDF 或任意其他设备 ECG 版式。
- 矢量路径支持标准线段及原始报告绘图；复杂 Form XObject、特殊色彩空间、多张拼接扫描图和多重压缩过滤器可能不支持，需导出完整 PNG/JPEG。遇到缺行拒绝分析，不补成看似正常的完整报告。
- 光栅来源精度较低，QRS 可能偏宽，截断判断不可靠。截图无文字层时不推测身份、手表分类或时间，ID 用内容哈希生成。
- 单导联不能确定房性/室性早搏或排除束支阻滞；呼吸性心律不齐可能影响提前搏动判断，轻度提前可能漏检。HRV 只用于相同条件下自身对比。
- T 波低、逐拍 QT 波动、P 波不可测、快心率、非手腕位置及宽 QRS 会限制部分形态评估。ST/T/PR/QTc 未在本项目上获得外部逐项真值验证；不进行房颤诊断。
- 浏览器自动化覆盖 Chromium 桌面和手机尺寸，不能替代真实 iPhone、Safari、快捷指令及纸面打印验收。

## 隐私与部署

文件会上传至运行 API 的服务器，与纯本地 Python 的数据流不同。应用代码不把上传内容或结果写入数据库、文件或对象存储；处理使用有界缓冲，释放时间由运行时垃圾回收决定，不承诺“立即销毁”。平台访问日志与留存由部署者配置。自由填写的症状文本不做通用个人信息识别，默认脱敏指身份字段不进入报告。

前端 localStorage 仅保存主题。下载和主动启用身份的报告由用户管理。不要把私人记录提交到测试或公开仓库；公共夹具均为合成数据。

Cloudflare Pages：静态目录 `public`，Functions 目录 `functions`。Git 集成应配置构建命令 `npm run build`、产物目录 `public`；手动部署使用项目的 Wrangler：

```bash
npx wrangler pages deploy public
```

发布前完成 CI。根据实际边缘 CPU/内存配额评估负载与限流；本项目不承诺未经测量的“毫秒级”生产延迟。`medianFilter` 使用排序数组维护窗口，最坏复杂度 O(NW)。

## 许可证

Copyright © 2026 Chizukuo。按 [GPL-3.0-or-later](LICENSE) 发布，不提供担保。本项目与 Apple Inc. 无关，未获其认可。
