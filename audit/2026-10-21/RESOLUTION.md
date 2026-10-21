# Python 对齐修复与验收

日期：2026-10-21。原始问题及证据保留于 [初始报告](REPORT.md)，原始 evidence/dependency-audit 文件是修复前快照，不代表当前状态。

## 已完成的实现

| 原编号 | 修复 | 对应验证 |
|---|---|---|
| F01 | 页面 JS 独立为 app.js，移除重复声明，纳入构建语法检查 | build；桌面/手机浏览器上传与示例 |
| F02 | API、SVG、PNG、JSON 默认移除 identity；显式 include_identity=1 才保留，默认导出不带源文件名 | presentation 单元；浏览器默认/显式身份；HTTP |
| F03 | PDF 使用当前页面对象引用和顺序拼接 Contents；忽略无引用旧流；检查三行与覆盖范围 | split Contents、对象流、无引用 decoy、半份 PDF 回归 |
| F04 | API 输出统一 assessment 与实际 qtc_formula；前端显示可靠性和跳过理由，不重新判 QTc/PR | presentation；19 类形态/阈值/位置 HTTP 对照；浏览器 |
| F05 | SVG 不再把空 alerts 描述为全部正常，缺测和跳过原因保留于报告/页面 | 低平 T 波与 skipped 回归 |
| F06 | 有界读取请求、PDF/PNG 累计解压上限、图片像素和 JPEG 内存限制、字体范围、绘图深度/数量限制；采样率范围与原版一致 | 流式超限、CMap 超限；PDF 结构；PNG/JPEG/扫描 PDF |
| F07 | 总状态根据结构化提醒、节律、质量与评估覆盖决定；通用说明不再当成异常 | 正常记录通用 flags 单元 |
| F08 | 提前搏动只合计两种 premature，形态异常独立统计 | odd-only 单元与浏览器输出 |
| F09 | 严格检查枚举、布尔参数、完整数值和重复参数；非法输入 400 | 参数单元/HTTP |
| F10 | 修复 SOS padlen/稳态初值、FIR filtfilt、非 512 Hz Butterworth、偶数最大值窗口；补齐 CPython rounding 和 std | 5 种 fs 的独立 SciPy/NeuroKit 数值夹具（误差 <1e-8）、舍入边界 |
| F11 | arange 端点/有效步长与 Python 对齐；PDF 坐标采用 PyMuPDF 单精度语义，归行和同 X 点保留规则对齐 | 19 类矢量 PDF 样本数、节律、HRV、形态、逐拍表、质量严格相等；CSV |
| F12 | 页面增加 sex、placement、exclude、身份开关和定标选项 | 浏览器请求参数和状态回显 |
| F13 | Node 要求统一 ≥22.12，CI 使用 Node 22/24 | 本地 Node 24；远程矩阵工作流 |
| F14 | CI 固定 Python 基准 SHA，运行原版测试、独立启动的 Wrangler HTTP 对照及浏览器测试；服务缺失失败 | run-integration.py；CI workflow |
| F15 | README 示例使用 morphology_alerts.alerts、状态码和 nullable 检查 | README Python 示例端到端执行 |
| F16 | JSON 保留 tool_version/source，明确 schema、覆盖范围和 summary，SVG 可省略 | API 单元与 HTTP |
| F17 | 清除硬编码私人路径、姓名、生日；可选真实输入改用环境变量 | 源码检查；默认跳过可选测试，合成身份独立验证 |
| F18 | 保留有坐标的自动缩放图；增加有毫米尺寸、方波和小网格的定标模式；打印只输出看板并明确原始尺寸要求 | 浏览器验证定标 SVG 的物理 CSS 宽度、打印隐藏及两种模式实际生成单页 A4 PDF；SVG/PNG 导出 |
| F19 | exported_at 为 UTC ISO，明确其与本机时区 Python 展示的格式差异 | 元数据实现及 README 契约 |
| F20 | 400/413/422/500 分类，内部错误不透传详情，所有分析错误 no-store | 非法表单、非法参数、超限、格式回归 |
| F21 | 0 与 null 分开，RMSSD=0 正常显示 | 页面函数修改及浏览器流程 |
| F22 | 缺少时间的 ID 用内容 SHA-1 前 8 位，与 Python 一致 | 图像 ID 和加载逻辑 |
| F23 | 复杂度说明改为 sorted array 最坏 O(NW)，移除未经测量的毫秒级与立即销毁承诺 | README 和代码说明核对 |

此外增加了原版的光栅输入、连续信号 CSV、批量记录切换与 summary.csv；公开示例明确标注合成数据；依赖升级消除了本次 npm 已知告警。批量汇总字段由后端共用 summaryRow 产生，避免前端再实现一套算法。

## 验证范围

- 构建检查页面脚本语法和严格 TypeScript。
- 单元回归包括 PDF 引用结构、隐私、状态解释、错误参数、数值库、边界及资源限制。
- HTTP 套件包含原有 18 类合成节律场景，新增 19 类形态/参数组合、排除与 CSV、3 种光栅来源、错误请求和 README 示例。可选私人记录默认跳过。
- 矢量形态用例对照样本数量、rhythm、hrv、morphology、beats、quality 和 summary，不只比较平均心率。滤波器夹具来自 Python 库，保留生成版本。
- Playwright 验证 Chromium 桌面及手机尺寸下的上传、主题、示例、分析选项、身份开关、全部导出、批量汇总、定标打印 CSS 尺寸及默认/定标两种模式实际生成单页 A4 PDF。
- 原版 Python 也重新执行其全部公开测试。依赖审计以当前 lockfile 为准，历史审计 JSON 留作证据。

最终实际运行结果与推送提交见本文件末尾的验收记录。未做真实 iPhone/Safari、快捷指令安装、实物量尺及 Web 独立 MIT-BIH 全集验证；这些不冒充已通过。生产负载、Cloudflare 配额及日志配置仍由部署者管理。

## 可复现命令

```bash
npm ci
npm run build
npm test
npm run test:integration
npx playwright install chromium
npm run test:e2e
npm audit --audit-level=moderate
```

HTTP 对照需要同级 Python 基准仓库或 `APPLE_WATCH_ECG_PY_DIR`，依赖见 README。Windows 可用 `PW_BROWSER_CHANNEL=chrome` 指定已安装 Chrome；CI 使用下载的 Playwright Chromium。

原 `reproduce.py/probe.ts` 保留为补充诊断工具，当前输出写入 verification.json，不覆盖修复前 evidence.json；它不代替正式测试。

## 本地验收记录

- 严格类型/页面脚本构建：通过；Prettier 检查：通过。
- TypeScript：58 passed，1 个可选真实 PDF 测试跳过。
- HTTP 独立服务对照：43 passed，1 个可选私人记录跳过；包含实际执行 README 示例。
- Python 原版：72 passed，1 个本地私人数据测试跳过。
- Chromium 桌面/手机尺寸：6 passed，含全部导出、批量重名后缀、summary、定标打印宽度及两种模式实际生成单页 A4 PDF。
- npm audit：0 项已知告警（含开发依赖）。
- 补充诊断：15 类原始波形的基准字段相等，4 个 PDF 内容流变体均得到 15,175 点；滤波差异约 4.2e-13，偶数最大值窗口不一致数为 0。详见 verification.json。

远程验证以本次推送提交的 [CI 检查](https://github.com/Chizukuo/apple_watch_ecg_web/actions/workflows/ci.yml) 为准，覆盖 Ubuntu/Node 22 与 Windows/Node 24。实际 iPhone、Safari、相册快捷指令和纸面量尺保持为明确的验证边界，不以模拟视口替代实机证明。

CI 工具链进一步固定到官方 Actions v7 的提交 SHA（Node 24 运行时），并为 Linux 原版图表测试安装 Noto CJK 字体；避免旧 Action 运行时弃用和中文缺字告警。工作流仅授予 contents:read。
