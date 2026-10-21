# iOS 快捷指令与性能

2026-10-21 核对的 [iCloud 共享快捷指令](https://www.icloud.com/shortcuts/1eac247c7d264fc591c4db4239875277) 与用户提供的 iPhone 编辑界面一致。公开动作定义保存在 [analyze-ecg.plist](analyze-ecg.plist)，仅作为可审查的源码快照；安装仍使用 iCloud 链接，外链以后可能更新。

流程接收分享表单的 PDF，无输入时提示“请分享心电图PDF”；执行的动作只有：

1. “获取 URL 的内容”：`POST https://ecg.chizunet.cc/api/analyze?format=svg`，请求正文类型为**文件**，值为**快捷指令输入**。
2. “快速查看”：输入为上一步“URL 的内容”。

不要在这两步间增加 Base64 编解码、截图、JSON 提取或第二次分析请求。保留原始 PDF 能避免图片解码与光栅波形提取；API 默认不输出身份信息。不需要改动现有快捷指令 URL。当前公开流程没有“存储到相簿”动作。

## 本次优化

- PDF 首页只分词一次，文字与绘图提取共享只读 token；常见 ASCII 边界通过字符码判断，保留字符串、注释、转义及 Unicode 空白处理。
- SVG 使用隐式 line-to 指令，省略坐标尾部 `.0`；保留原有每个顶点和 `toFixed(1)` 精度，不降采样、不改波形、测量或分析逻辑。
- 不引入记录缓存、额外请求或持久化个人数据；服务更新后现有快捷指令直接使用优化结果。

## 本地测量

Windows、Node v24.11.1，使用仓库 `test/fixtures/synthetic_demo.pdf`；基准为提交 `2dcdcbe`。新旧代码在同一进程交替执行，分别预热 8 次、测量 40 次。时间为中位数：

| 项目 | 优化前 | 优化后 | 变化 |
|---|---:|---:|---:|
| PDF 解析 | 38.95 ms | 21.80 ms | −44% |
| 解析＋分析＋SVG | 62.93 ms | 46.89 ms | −25% |
| SVG UTF-8 大小 | 452,508 B | 376,639 B | −17% |
| 本地 gzip 后大小 | 118,393 B | 110,412 B | −7% |

这不是 iPhone 端到端耗时或 Cloudflare CPU 计费测量；不包含移动网络、冷启动与“快速查看”。gzip 是本地体积对照，不代表线上一定采用该编码。完整阶段与 p95 数据见 [benchmark.json](benchmark.json)。新旧报告内容及 SVG 路径的全部数值坐标已作相等检查。

## 复现

`npm run benchmark:shortcut` 测量当前代码，输出到忽略提交的 `benchmark-results/shortcut-benchmark.json`，不把机器相关耗时用作测试通过条件。

与旧版交替比较时，先用 `git archive --format=zip --output=benchmark-results/shortcut-baseline.zip 2dcdcbe src` 导出基准，再解压到 `benchmark-results/shortcut-baseline/`，确保其中存在 `src/`。PowerShell：

```powershell
New-Item -ItemType Directory -Force benchmark-results | Out-Null
git archive --format=zip --output=benchmark-results/shortcut-baseline.zip 2dcdcbe src
Expand-Archive -LiteralPath benchmark-results/shortcut-baseline.zip -DestinationPath benchmark-results/shortcut-baseline -Force
$env:SHORTCUT_BENCH_BASELINE = '1'
npm run benchmark:shortcut
Remove-Item Env:SHORTCUT_BENCH_BASELINE
```

功能回归执行 `npm run build`、`npm test`、`npm run test:integration` 与 `npm run test:e2e`。真实 iPhone 网络及 SVG 预览仍需设备验收。
