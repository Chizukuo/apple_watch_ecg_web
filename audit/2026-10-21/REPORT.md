# Apple Watch ECG 网页版全面审查报告

**历史快照：本报告记录初始基线的发现；当前修复和验证状态见 [RESOLUTION.md](RESOLUTION.md)。**

审查日期：2026-10-21（Asia/Hong_Kong）
网页版基线：`0b6e460acec7b0aa1972861cb1b2517f3481b9c6`
Python 基线：`a7262bdbb271fd51960adf08004362885b3bc939`

## 1. 总体结论

**当前网页版不宜被描述为“与 Python 100% 零误差对齐且默认脱敏”的完整替代品。建议先修复页面加载、PDF 完整性、身份输出和测量可信度显示，再继续发布。**

核心分析管线的移植有良好基础：本次 15 类 512 Hz 合成原始信号的节律、HRV、平均心搏和形态提醒字段，与 Python 输出一致；现有的 18 项本地 HTTP 合成对照测试也全部通过。主要问题集中在输入提取、前端解释、隐私边界和验证体系，而不是所有算法均有问题。

但存在以下直接影响用户的缺陷：

1. 页面同一脚本重复声明变量，整个页面脚本无法加载。
2. API 和 SVG 默认输出姓名，JSON 还含出生日期，与 Python 默认隐私策略及 README 相反。
3. 合法 PDF 拆分内容流后，网页版可能只分析半份记录，却成功返回完整样式的报告。
4. 前端忽略 QT 可靠性、快心率公式选择及边界规则；SVG 又把“未发出提醒”解释为“指标全部正常”。
5. 上传大小限制未覆盖解压、采样率和 CMap 扩展，缺少内部资源上限。
6. 现有 CI 既不运行浏览器页面，也不运行 Python HTTP 对照，因此绿灯没有覆盖上述关键问题。

下文列出 **23 项审查发现：6 项 P1、14 项 P2、3 项 P3**。P1 表示应优先修复的发布阻断或高影响问题；P2 表示功能、可靠性或工程缺陷；P3 表示较低影响的正确性及文档问题。“代码确认风险”与“动态复现”分开标明，未把风险推断当作线上事故。

本次只增加审查报告和复现材料，未修改产品源码、未提交或部署。

## 2. 范围、方法与验证结果

### 2.1 审查范围

读取并对照 Python 主程序、合成数据工具、测试和验证说明，以及网页版全部核心模块、PDF 解码器、SVG 渲染器、API、静态页面脚本、测试、README、依赖锁文件及 CI 配置。审查覆盖：

- PDF 文字、字体、绘图和元数据提取；采样、拼接、校准、截断。
- 基线、QRS 检测、补检、T 波抑制、形态对齐和逐拍分类。
- NN/HRV、长间歇、二联律、平均心搏、双基线和提醒规则。
- 页面交互、结果解释、导出、隐私、异常输入和资源边界。
- 对齐验证、可复现性、运行条件和文档承诺。

Python 作为行为基准，不把其所有行为视为独立医学真值。本报告评估代码一致性和产品行为，不重新评定临床指南本身。

### 2.2 实际执行

| 检查 | 结果 | 能证明的范围 |
|---|---|---|
| Python `python -m pytest -q` | 72 passed，1 skipped，52.50 秒 | 当前环境的原版回归；跳过本地私人数据用例 |
| Web `npm test` | 30 passed，1 skipped | 5 个测试文件；跳过可选真实 PDF |
| Web `npm run build` | 通过 | TypeScript 类型检查，不检查 HTML 内脚本 |
| HTTP `python -m pytest test/test_against_web_api.py -q -k "not real_user"` | 18 passed，1 deselected，15.26 秒 | 本地 Wrangler 上的现有合成测试；主动排除写死私人文件路径的用例 |
| 页面脚本语法检查 | 失败 | `Identifier 'currentScale' has already been declared` |
| 新增 15 类 512 Hz 原始波形对照 | 所比较字段全部一致 | 正常、快心率、长短 QT、宽 QRS、长短 PR、ST/T 和高大/低平 T 波 |
| 新增 256/1000 Hz 正常原始波形对照 | 所比较字段一致 | 仅两个正常用例，不代表滤波器对所有采样率等价 |
| PDF 端到端及内容流变体 | 发现提取差异和严重截短 | 详见 F03、F11 |
| 独立 DSP 数值对照 | 有差异 | 详见 F10，未据此宣称所有真实 ECG 都会误判 |
| 前端 `renderResults` 隔离执行 | 复现错误标签 | 绕开语法阻断，仅提取函数并以最小 DOM 桩执行；不是实机浏览器视觉验收 |
| `npm audit --json` | 3 个受影响包条目 | 开发依赖：1 moderate、2 critical；详见第 7 节 |
| `npm audit --omit=dev --json` | 0 项 | 注册库已知生产依赖告警，不等于应用无漏洞 |

运行环境：Windows、Python 3.13.7、Node 24.11.1；实际安装 TypeScript 5.9.3、Vitest 3.2.7、Wrangler 4.151.1。Python 首次收集因缺少 `neurokit2` 失败，补装项目要求的 `neurokit2==0.2.13` 后重新运行并通过。

### 2.3 证据与复现

审查目录中的材料：

- [reproduce.py](reproduce.py)：生成合成输入、对照 Python/TS、检查本地 API，使用临时目录保存生成的 PDF。
- [probe.ts](probe.ts)：只用于审查的 TS/DSP/页面函数探针。
- [evidence.json](evidence.json)：字段差异和复现结果；不包含私人记录。
- [dependency-audit.json](dependency-audit.json)、[dependency-audit-production.json](dependency-audit-production.json)：本次依赖审计结果。

在网页版目录运行：

```powershell
# 终端一：项目本地开发服务
npm run dev -- --ip 127.0.0.1 --port 8788 --show-interactive-dev-session=false

# 终端二：审查探针；默认 Python 仓库为同级 apple_watch_ecg
python audit/2026-10-21/reproduce.py
```

命令使用项目已安装版本，并核验了本地 `wrangler pages dev --help`；相关命令说明见 [Cloudflare Pages CLI 文档](https://developers.cloudflare.com/workers/wrangler/commands/pages/)。该复现不会向生产站点上传数据。

## 3. P1：优先修复的高影响问题

### F01 — 网页脚本重复声明，全部交互失效

**证据：动态复现。** [public/index.html:965](https://github.com/Chizukuo/apple_watch_ecg_web/blob/0b6e460acec7b0aa1972861cb1b2517f3481b9c6/public/index.html#L965) 和 [public/index.html:1234](https://github.com/Chizukuo/apple_watch_ecg_web/blob/0b6e460acec7b0aa1972861cb1b2517f3481b9c6/public/index.html#L1234) 在同一个 `<script>` 顶层两次执行 `let currentScale = 1.0`。

JavaScript 在解析时就抛 SyntaxError，脚本整体不执行。文件选择、拖放、分析请求、示例、主题切换和导出函数均无法正常初始化。现有 `tsc` 只包含 `src/functions/test`，所以构建与单元测试均未发现。

**修复与验收：** 保留一次声明；把页面脚本纳入构建检查；用真实浏览器打开页面，验证无 console/page error，选择合成 PDF 后能完成分析及下载。

### F02 — 默认输出身份，与 Python 和隐私声明相反

**证据：代码确认 + 合成输入 HTTP 复现。** [functions/api/analyze.ts:117](https://github.com/Chizukuo/apple_watch_ecg_web/blob/0b6e460acec7b0aa1972861cb1b2517f3481b9c6/functions/api/analyze.ts#L117) 无条件返回 `rec.identity`；[src/render/svg.ts:48](https://github.com/Chizukuo/apple_watch_ecg_web/blob/0b6e460acec7b0aa1972861cb1b2517f3481b9c6/src/render/svg.ts#L48) 把姓名写入 SVG；页面 [public/index.html:1120](https://github.com/Chizukuo/apple_watch_ecg_web/blob/0b6e460acec7b0aa1972861cb1b2517f3481b9c6/public/index.html#L1120) 显示姓名。

Python 的 [apple_watch_ecg.py:1234](https://github.com/Chizukuo/apple_watch_ecg/blob/a7262bdbb271fd51960adf08004362885b3bc939/apple_watch_ecg.py#L1234) 只有显式 `include_identity=True` 才将身份加入输出；默认看板标题也来自脱敏后的报告。网页版没有等价开关。合成 PDF 默认 POST 已返回姓名及出生日期；下载 JSON、SVG 和由 SVG 转成的 PNG 会携带身份。

README 第 220 行却宣称默认脱敏。**这不代表存在读取其他用户文件的越权漏洞，而是用户对默认导出、分享和留存内容的预期被破坏。**

**修复与验收：** 默认移除身份；确需显示时由明确选项开启，并让 API、页面、SVG、PNG、JSON 一致执行。使用合成独特姓名和生日，递归检查默认响应及所有导出均不包含这些字符串。

### F03 — 只取最长绘图流，合法 PDF 被截成半份仍成功分析

**证据：动态复现。** [src/core/pdf/index.ts:110](https://github.com/Chizukuo/apple_watch_ecg_web/blob/0b6e460acec7b0aa1972861cb1b2517f3481b9c6/src/core/pdf/index.ts#L110) 扫描所有流后，只把最长一个候选流作为 `vectorStreamStr`，未按页面 `/Contents` 顺序组合。

把同一份合成 PDF 的可见页面内容拆成两个内容流，并清除无引用旧对象后：

| 指标 | Python | Web |
|---|---:|---:|
| 连续样本数 | 15,175 | 6,839 |
| 最后采样时间 | 29.998 秒 | 13.717 秒 |
| 检出心搏 | 35 | 16 |
| 平均心率 | 72.0 | 72 |

网页版没有报错，平均心率还看似正确，因此仅比心率的检查很难发现。后半段异常事件可能根本没有进入分析。扫描全文件流也会把未引用旧对象、其他页面或字体中的候选内容纳入选择；后者为代码确认的结构风险，未进行私人数据泄露实验。

**修复与验收：** 解析页面对象树和内容流引用，保持图形状态与顺序；至少对行数、覆盖时间、预期样本数做完整性检查。将单流、双流、增量保存、额外页面和无引用旧对象纳入回归；相同可见内容应得到一致信号。

### F04 — 前端 QTc 判断绕过后端公式、可靠性和阈值

**证据：隔离函数动态复现。** [public/index.html:1172](https://github.com/Chizukuo/apple_watch_ecg_web/blob/0b6e460acec7b0aa1972861cb1b2517f3481b9c6/public/index.html#L1172) 固定主显示 Bazett，并自行使用 `>460`、`<360`、`>450`。后端 [src/core/alerts.ts:75](https://github.com/Chizukuo/apple_watch_ecg_web/blob/0b6e460acec7b0aa1972861cb1b2517f3481b9c6/src/core/alerts.ts#L75) 按心率选公式，检查 T 波幅度与逐拍稳定性，再按性别和包含边界的阈值处理。

已复现：

- `qt_reliable=false, QTcB=520`：前端仍显示“QTc 延长”。
- 心率 115、QTcB=480、QTcF=430：前端显示延长，后端选 Fridericia 时无 QTc 延长提醒。
- QTcB 恰好 450 或 360：前端显示正常，后端在对应默认阈值触发提醒。

PR 单元也忽略快心率时 `skipped` 给出的不可靠判断，而重新显示正常或长短。由于 F01，目前这些是页面修复语法后会暴露的逻辑问题，不能视为当前页面已经正常运行。

**修复与验收：** 后端输出统一的所用公式、评估状态、级别、原因；前端据此渲染。覆盖阈值前后、男女/未知、心率 100/101、不可测、低 T 波和大 QT IQR，并检查页面与 JSON/SVG 一致。

### F05 — SVG 把“未提醒”错误表达为“所有测量正常”

**证据：合成原始波形动态复现。** [src/render/svg.ts:495](https://github.com/Chizukuo/apple_watch_ecg_web/blob/0b6e460acec7b0aa1972861cb1b2517f3481b9c6/src/render/svg.ts#L495) 只根据 `alerts.length` 决定是否显示绿色“测量指标均在 AHA/ESC 正常生理范围内”。

低平 T 波用例 `flatT` 的 QT 不可靠、QTc 评估被跳过，但生成 SVG 仍含上述绿色结论。平均模板不存在、非手腕跳过 ST/T、快心率跳过 PR 等分支也没有参与这个总判断。没有报警不能推导出已完成所有评估并全部正常。

**修复与验收：** 改用“已评估项目未触发形态提醒”等与覆盖范围相符的描述，展示未评估项目及原因；存在不可测/不可靠项目时不输出全面正常承诺。覆盖无模板、低 T 波、非手腕和快心率。

### F06 — 内部资源上限缺失，15 MB 上传限制不足

**证据：部分动态复现，部分代码确认风险。**

- [src/core/pdf/index.ts:227](https://github.com/Chizukuo/apple_watch_ecg_web/blob/0b6e460acec7b0aa1972861cb1b2517f3481b9c6/src/core/pdf/index.ts#L227) 直接信任 PDF 里的 `Hz`。合成 PDF 声称 9,999 Hz 时，Python 按 `100..2000` 校验并回退 512 Hz，Web 却分配 296,336 个连续样本，约为正常数量的 19.5 倍。
- [src/core/pdf/index.ts:59](https://github.com/Chizukuo/apple_watch_ecg_web/blob/0b6e460acec7b0aa1972861cb1b2517f3481b9c6/src/core/pdf/index.ts#L59) 直接 `inflate` 所有匹配流，无累计解压字节上限。
- [src/core/pdf/encoding.ts:100](https://github.com/Chizukuo/apple_watch_ecg_web/blob/0b6e460acec7b0aa1972861cb1b2517f3481b9c6/src/core/pdf/encoding.ts#L100) 按 CMap 声明范围逐项扩展，无映射数量上限。
- [functions/api/analyze.ts:73](https://github.com/Chizukuo/apple_watch_ecg_web/blob/0b6e460acec7b0aa1972861cb1b2517f3481b9c6/functions/api/analyze.ts#L73) 在实际大小检查前已完整 `formData/arrayBuffer`；没有 Content-Length 时，15 MB 检查不能阻止先分配请求体。

这些路径可放大 CPU/内存成本。未进行超大解压、服务耗尽或线上负载实验，**本报告不声称已证明生产站点可被打崩**。

**修复与验收：** 对采样率、时间跨度、样本总数、页数、路径/点数、CMap 项数、单流及累计解压量设硬上限；非法范围明确拒绝或有提示地回退；输入流达到上限即停止读取。用小型边界测试验证可控失败，避免用压力攻击代替回归测试。

## 4. P2：功能、对齐和工程问题

### F07 — 正常记录也会显示“检出形态/早搏提示”

**证据：隔离函数动态复现。** [public/index.html:1128](https://github.com/Chizukuo/apple_watch_ecg_web/blob/0b6e460acec7b0aa1972861cb1b2517f3481b9c6/public/index.html#L1128) 将 `flags.length > 0` 当作异常。后端 [src/core/pipeline.ts:492](https://github.com/Chizukuo/apple_watch_ecg_web/blob/0b6e460acec7b0aa1972861cb1b2517f3481b9c6/src/core/pipeline.ts#L492) 总会附加 HRV 局限及导联说明，所以无异常正常记录同样进入 warning 分支。标题“正常”分支基本不可达。

风险级别还通过中文子串匹配，容易随文案变化失效。应分开记录通用说明、质量提示、节律事件及结构化形态提醒，以结构化状态决定标签。验收：无异常合成记录不得因通用免责声明变为异常。

### F08 — 把形态异常直接计作早搏

**证据：隔离函数动态复现。** [public/index.html:1208](https://github.com/Chizukuo/apple_watch_ecg_web/blob/0b6e460acec7b0aa1972861cb1b2517f3481b9c6/public/index.html#L1208) 把 `n_odd` 加入 `nEctopic`，随后显示“检出 N 拍早搏”。仅有 `n_odd=1`、两个提前计数均为 0 时，已复现“检出 1 拍早搏”。Python 对该类的定义是时间正常但形态异常，可能为伪影或接触变化。

修复：早搏计数只使用两种提前标签；形态异常独立显示。不要把算法的保守标签升级为更确定的结论。

### F09 — API 参数错误被静默接受

**证据：HTTP 动态复现。** [functions/api/analyze.ts:12](https://github.com/Chizukuo/apple_watch_ecg_web/blob/0b6e460acec7b0aa1972861cb1b2517f3481b9c6/functions/api/analyze.ts#L12) 对非法 exclude 片段 `continue`，并使用宽松 `parseFloat`；[functions/api/analyze.ts:101](https://github.com/Chizukuo/apple_watch_ecg_web/blob/0b6e460acec7b0aa1972861cb1b2517f3481b9c6/functions/api/analyze.ts#L101) 对非法 sex/placement 静默降为默认。

| 请求 | 实际响应 |
|---|---|
| `exclude=bad` | 200，排除列表为空 |
| `exclude=0-2junk` | 200，按 `[0,2]` 接受 |
| `sex=M&placement=chest` | 200，变成 `unknown/wrist` |

用户可能以为已排除体动或声明非标准佩戴，实际分析条件却不同。应完整匹配数值、检查有限性及区间，并对非法枚举返回明确 400；有效参数保持兼容。Python CLI 的参数错误和排除段解析更严格。

### F10 — DSP 实现不能称为 SciPy/NeuroKit 数值等价

**证据：独立 DSP 动态对照 + 源码确认。** [src/core/dsp.ts:427](https://github.com/Chizukuo/apple_watch_ecg_web/blob/0b6e460acec7b0aa1972861cb1b2517f3481b9c6/src/core/dsp.ts#L427) 的 SOS 前后向滤波存在以下差异：

1. `padLen` 固定按 `3*(2*nSections+1)`，没有 SciPy 针对原点零极点的补偿；此 5 阶滤波器对应默认值为 18，Web 用 21。
2. [src/core/dsp.ts:474](https://github.com/Chizukuo/apple_watch_ecg_web/blob/0b6e460acec7b0aa1972861cb1b2517f3481b9c6/src/core/dsp.ts#L474) 每节使用全零初始状态，没有 SciPy 的稳态初值处理。
3. [src/core/dsp.ts:494](https://github.com/Chizukuo/apple_watch_ecg_web/blob/0b6e460acec7b0aa1972861cb1b2517f3481b9c6/src/core/dsp.ts#L494) 用两遍 nearest 移动平均模拟 powerline；NeuroKit 实际使用 `scipy.signal.filtfilt`，边界处理不同。
4. [src/core/dsp.ts:219](https://github.com/Chizukuo/apple_watch_ecg_web/blob/0b6e460acec7b0aa1972861cb1b2517f3481b9c6/src/core/dsp.ts#L219) 的最大值滤波对偶数 size 扫描 `2*floor(size/2)+1` 个点，实际多一个点。
5. `ecgClean` 接收任意 fs，却始终使用 512 Hz 的高通系数。

输入 `x[i]=2+sin(0.09*i)`、2,000 点、512 Hz：高通最大绝对误差约 **1.13347**，去掉两端各 512 点后仍约 **0.40545**；完整清洗最大绝对误差约 **1.00352**。size=4 最大值滤波与 SciPy 的 2,000 个输出中有 **952** 个不同。

这些是底层数值等价性反例；本次 15 类正常居中 ECG 管线输出及额外两个非 512 Hz 正常用例仍一致，不能把 DSP 反例解释成临床误判率。应按原库实现补齐边界和初值，对多个 fs、常数偏置、阶跃、短输入、奇偶窗口建立数值差分测试。

### F11 — 两层重采样使用 floor，丢失有效末端样本

**证据：PDF 动态对照。** [src/core/pdf/vector.ts:172](https://github.com/Chizukuo/apple_watch_ecg_web/blob/0b6e460acec7b0aa1972861cb1b2517f3481b9c6/src/core/pdf/vector.ts#L172) 与 [src/core/signal.ts:89](https://github.com/Chizukuo/apple_watch_ecg_web/blob/0b6e460acec7b0aa1972861cb1b2517f3481b9c6/src/core/signal.ts#L89) 用 `floor((end-start)/dt)` 分配数组；Python 的 `np.arange(start,end,dt)` 对非整数跨度通常会保留多一个仍小于 end 的样本。

标准合成 PDF 在 Python 得到 15,175 点，Web 得到 15,172 点；R 振幅输出分别为 0.942 和 0.941 mV。不是所有差异都必然由 floor 单独造成：矢量路径归行、同 X 点保留策略也与 Python 不同。

修复：明确端点约定，在两层采样中统一执行；对相同 PDF 分层比较 t/v/clip、行边界、样本数与末端。避免仅用最终心率“相近”证明提取一致。

### F12 — 网页不能选择原版的重要分析条件

**证据：页面与请求代码确认。** [public/index.html:1086](https://github.com/Chizukuo/apple_watch_ecg_web/blob/0b6e460acec7b0aa1972861cb1b2517f3481b9c6/public/index.html#L1086) 永远请求 `format=json`，没有 sex、placement 或手动 exclude 控件。后端虽支持，页面用户只能使用 unknown/wrist/无手动排除。

这会让非手腕记录也按默认腕部规则评估 ST/T，且无法通过页面复现 Python `--exclude` 和女性阈值。应添加分析条件及结果回显；默认值与 Python 一致，但不能把条件固定后宣称完整交互等价。

### F13 — Node 运行要求与锁文件、CI 不一致

**证据：锁文件和已安装入口确认。** [README.md:172](https://github.com/Chizukuo/apple_watch_ecg_web/blob/0b6e460acec7b0aa1972861cb1b2517f3481b9c6/README.md#L172) 写 Node ≥20，[.github/workflows/ci.yml:15](https://github.com/Chizukuo/apple_watch_ecg_web/blob/0b6e460acec7b0aa1972861cb1b2517f3481b9c6/.github/workflows/ci.yml#L15) 使用 20；实际锁定 Wrangler 4.151.1 和 Miniflare 要求 Node ≥22。Wrangler 入口也明确检查最低 22，旧版本会退出。

`npm test` 绿灯并不意味着 `npm run dev` 可在文档支持的 Node 20 上启动。应统一 `engines`、README、CI 与开发运行环境，添加本地服务启动/健康检查。没有在 Node 20 上重跑整个 CI，结论依据是锁文件要求和入口拒绝逻辑。

### F14 — 测试体系没有覆盖其所宣称的完整对齐

**证据：配置和测试源码确认。** CI 只运行 npm ci、tsc 和 Vitest；不检出 Python 基准仓库、不安装 Python 依赖、不启动 HTTP 服务、不运行 Python 对照，也不加载页面。

[test/test_against_web_api.py:48](https://github.com/Chizukuo/apple_watch_ecg_web/blob/0b6e460acec7b0aa1972861cb1b2517f3481b9c6/test/test_against_web_api.py#L48) 在健康检查失败时整组 skip，所以只运行 README 的 pytest 命令可能得到全跳过。18 个合成用例主要覆盖节律和部分元数据；并没有逐例核对所有 PR、QTc 和形态提醒。原生 alerts 测试多数直接构造测量结果，不能覆盖提取到提醒的全链路。

修复：固定 Python 基准提交，CI 实际启动本地服务并等待 health；对照任务中服务不可用应失败；增加页面 smoke 和形态异常 PDF 全链路用例。保留单元测试，但别让它代替端到端验证。现有测试采用容差，不能支持“零误差”措辞。

### F15 — README 的提醒读取示例会静默漏掉提醒

**证据：HTTP 动态复现。** [README.md:154](https://github.com/Chizukuo/apple_watch_ecg_web/blob/0b6e460acec7b0aa1972861cb1b2517f3481b9c6/README.md#L154) 检查 `data.get('alerts')`，实际响应位于 `data['morphology_alerts']['alerts']`。

明显长 QT 合成 PDF 的 API 返回 `QTC_LONG_MARKED`，但文档示例的 `data.get('alerts')` 为 None，因此不打印。应修正示例并加入状态码和形态可用性检查；使文档示例作为实际集成测试运行。

### F16 — JSON 重组丢失报告来源和版本

**证据：API 动态结果与类型定义确认。** 管线 Report 有 `tool_version`、`source`，但 [functions/api/analyze.ts:112](https://github.com/Chizukuo/apple_watch_ecg_web/blob/0b6e460acec7b0aa1972861cb1b2517f3481b9c6/functions/api/analyze.ts#L112) 手工挑字段后漏掉两项。页面下载的 JSON 就是该响应，所以无法从报告本身可靠追踪算法版本与提取来源。

建议复用统一报告序列化函数，明确 API envelope 与 Python Report 的映射；提供 schema/version，避免下游把两份 JSON 当作完全同构。SVG 是 API 扩展字段，可以保留，但应说明且考虑让纯 JSON 请求按需生成 SVG。

### F17 — 对照测试硬编码个人身份和本机路径

**证据：源码确认。** [test/test_against_web_api.py:303](https://github.com/Chizukuo/apple_watch_ecg_web/blob/0b6e460acec7b0aa1972861cb1b2517f3481b9c6/test/test_against_web_api.py#L303) 写死 Downloads 中的记录路径，并断言完整姓名、出生日期和具体测量值。本报告不重复这些值，也没有读取或发送该私人文件。

这些身份信息本身已出现在被跟踪源码里，同时测试无法在其他机器复现，且把默认含身份当作正确行为。应改成环境变量指定可选输入，只检查非身份不变量；身份逻辑一律使用合成信息。公开仓库若确含未经授权个人数据，应由维护者核对并决定是否另行清理历史；本次未修改 Git 历史。

### F18 — 图形不是固定纸速、增益的标准毫米网格

**证据：绘图代码确认。** [README.md:102](https://github.com/Chizukuo/apple_watch_ecg_web/blob/0b6e460acec7b0aa1972861cb1b2517f3481b9c6/README.md#L102) 声称“标准 25 mm/s × 10 mm/mV 医用网格”；[src/render/svg.ts:99](https://github.com/Chizukuo/apple_watch_ecg_web/blob/0b6e460acec7b0aa1972861cb1b2517f3481b9c6/src/render/svg.ts#L99) 却按每行幅度自动选 vMin/vMax，再缩放至固定 115 SVG 单位高。时间轴是 1 秒网格，整体宽度由容器缩放，也没有固定打印毫米尺寸或 1 mV 定标方波。

两行相同 mV 变化的视觉高度可能不同，浏览器缩放和打印后不能拿尺按所称毫米比例测量。作为带数值坐标的自动缩放图可以使用，但须准确标注。若要支持标准临床纸速，需固定物理尺寸、增益和校准标记，并对 A4 打印实际量尺验收。本次没有进行实物打印或移动端视觉验收。

### F19 — 导出时间丢失时区语义

**证据：元数据实现对照。** [src/core/pdf/metadata.ts:329](https://github.com/Chizukuo/apple_watch_ecg_web/blob/0b6e460acec7b0aa1972861cb1b2517f3481b9c6/src/core/pdf/metadata.ts#L329) 从 CreationDate 直接拼接年月日小时分钟，忽略 Z/偏移；Python [apple_watch_ecg.py:237](https://github.com/Chizukuo/apple_watch_ecg/blob/a7262bdbb271fd51960adf08004362885b3bc939/apple_watch_ecg.py#L237) 对其支持的 Z 格式换算本机时区并显式标记 UTC 偏移。

例如合成 CreationDate 的 UTC `03:30Z`，Web 返回无时区的 `03:30`，香港用户可能误读为本地时间；香港时区下原版表达应为 11:30 并带偏移。此项不等于采集时间 recorded_at 必定偏移，两个字段来自不同来源。

应保存带时区 ISO 时间，展示时按明确时区转换；测试 UTC、+08、负偏移和跨日，避免依赖边缘服务器本地时区。

### F20 — 错误响应分类和隐私处理不完整

**证据：HTTP 动态复现及源码确认。** [functions/api/analyze.ts:146](https://github.com/Chizukuo/apple_watch_ecg_web/blob/0b6e460acec7b0aa1972861cb1b2517f3481b9c6/functions/api/analyze.ts#L146) 把非 AnalysisError 一律当 500，并直接返回底层 message；[functions/api/analyze.ts:28](https://github.com/Chizukuo/apple_watch_ecg_web/blob/0b6e460acec7b0aa1972861cb1b2517f3481b9c6/functions/api/analyze.ts#L28) 的错误响应缺少成功响应使用的 `Cache-Control: no-store`。

缺少 boundary 的 `multipart/form-data` 是客户端请求错误，已复现返回 500 及底层详细报错。应按输入错误/不可分析/内部错误分为 400/422/500，对 500 返回稳定错误码和通用文本，所有含记录相关信息的响应一致 no-store。未发现或证明当前异常 message 已泄露其他用户数据。

## 5. P3：较低影响问题

### F21 — RMSSD 为 0 时显示为缺失

**证据：隔离函数动态复现。** [public/index.html:1205](https://github.com/Chizukuo/apple_watch_ecg_web/blob/0b6e460acec7b0aa1972861cb1b2517f3481b9c6/public/index.html#L1205) 使用 truthiness；0 显示“—”。应使用 `!= null` 判断。年龄等字段也有类似真假判断，应区分 0、null、未提供。

### F22 — 缺少记录时间时所有文件都叫 ECG_IMPORT

**证据：源码对照。** [src/core/pdf/index.ts:250](https://github.com/Chizukuo/apple_watch_ecg_web/blob/0b6e460acec7b0aa1972861cb1b2517f3481b9c6/src/core/pdf/index.ts#L250) 用固定 `ECG_IMPORT` 作为回退；Python 对文件内容取哈希生成 ID。多份无时间 PDF 下载成相同报告名称，削弱关联和归档能力。应改用内容哈希或等价稳定 ID；不用含姓名的源文件名补救。

### F23 — 中值滤波复杂度说明不正确

**证据：源码确认。** [src/core/dsp.ts:164](https://github.com/Chizukuo/apple_watch_ecg_web/blob/0b6e460acec7b0aa1972861cb1b2517f3481b9c6/src/core/dsp.ts#L164) 和 [README.md:163](https://github.com/Chizukuo/apple_watch_ecg_web/blob/0b6e460acec7b0aa1972861cb1b2517f3481b9c6/README.md#L163) 称 O(N log W)，实际二分查找后使用数组 `splice` 删除/插入，元素移动是 O(W)，每点最坏 O(W)，总体最坏 O(NW)。

这不说明当前 30 秒记录一定慢，但不能用该实现证明复杂度和“毫秒级”承诺。可修正文档，或用真正支持对数级动态中位数的数据结构；性能结论另附本地/边缘 CPU 时间及 P50/P95 基准。

## 6. 与 Python 的能力对应

以下为产品能力差异，不全部作为缺陷计数。Web 可合理缩小范围，但应明确说明。

| 能力 | Python | 当前 Web | 评价 |
|---|---|---|---|
| Apple 原始矢量 PDF | 支持 | 支持子集 | 内容流完整性需修复；不能等同通用 PDF 引擎 |
| 扫描 PDF / 无矢量回退 | 光栅识别 | 不支持 | 应明确只接受原始矢量 PDF |
| PNG/JPG 截图 | 支持 | API 只接受 PDF | 有意范围差异，README 应列出不支持项 |
| 512 Hz 连续拼接 | 支持 | 支持 | 存在端点差异 F11 |
| 定标、截断、基线、伪影 | 支持 | 已移植 | 本次相关合成回归通过，不外推完整真实数据精度 |
| QRS、早搏、长间歇、二联律、RR 交替 | 支持 | 已移植 | 现有 HTTP 合成测试通过 |
| NN / HRV | 支持 | 已移植 | 15 类原始输入对照一致，页面 0 值显示需修复 |
| 双基线平均心搏与形态提醒 | 支持 | 已移植 | 后端主要规则对齐；UI/SVG 解释需修复 |
| sex / placement / exclude | CLI 支持 | API 支持，页面缺失 | 见 F09、F12 |
| 身份信息默认隐藏 | 是，显式开启 | 否 | 见 F02 |
| 单份 JSON | 含来源、版本等 | API envelope + SVG，漏字段 | 见 F16 |
| 连续信号 CSV | 支持 | 没有导出 | 不能直接替换依赖 CSV 的工作流 |
| 批量处理 / summary.csv | 支持 | 单文件页面/API | 明确产品范围即可 |
| SVG / 浏览器 PNG | Python 输出 PNG | Web 提供 SVG/PNG 路径 | 新增能力；页面语法修复后仍需实际浏览器验收 |
| 真实数据注入及 MIT-BIH 验证 | 仓库有方法及结果文档 | 未见等价 TS 验证工作流 | 不应直接把 Python 指标算作 Web 的已验证性能 |
| 无采集时间的稳定 ID | 文件哈希 | 固定 ID | 见 F22 |

补充的轻微实现差异：Python 的二联律起点循环可能保留后面的合格序列，而 Web 只保留首次；Python 的 round 与 JS Math.round 半整数处理不同；噪声估计中 Web 使用 RMS、Python 使用标准差。此次未将这些未产生已观察用户影响的差异列为高优先级问题，但若要求逐字段严格相等，应明确处理。

## 7. 依赖、部署和安全评价

### 7.1 依赖审计

本次 npm 注册库审计报告 3 个受影响包条目，均在开发依赖链中：

| 包 | npm 级别 | 公告 | 本次影响判断 |
|---|---|---|---|
| `@vitest/mocker` | moderate | [GHSA-82fw-gwwq-j7x9](https://github.com/advisories/GHSA-82fw-gwwq-j7x9) | 测试开发环境风险，不直接等同 Pages API 文件读取 |
| `tinypool` | critical | [GHSA-5gmw-xhrv-c9v3](https://github.com/advisories/GHSA-5gmw-xhrv-c9v3)、[GHSA-85c8-ppgw-ccpr](https://github.com/advisories/GHSA-85c8-ppgw-ccpr) | 有前置条件的 worker options/原型污染利用链；没有执行利用验证 |
| `vitest` | critical（依赖传播） | 依赖上述条目 | 属开发工具链；不应把包条目数当作独立应用漏洞数 |

仅生产依赖审计为 0。建议单独安排依赖升级并验证测试兼容性，依据公告的修复范围选择版本；不自动运行有破坏性升级的 `npm audit fix --force`。上述级别是 npm 输出，不是本报告对生产站点可利用性的定级。

### 7.2 已有的正面措施

- 分析代码未见数据库、对象存储写入或主动把上传数据转发给其他服务的路径。
- 成功分析响应设有 `Cache-Control: no-store`。
- PDF 有魔数和上传大小检查，SVG 动态文本通过 XML escaping，普通 findings 通过 HTML escaping。
- 前端没有把健康报告存入 localStorage；当前仅存主题。
- 算法模块划分较清楚，提醒阈值集中在 types/alerts，源码带 GPL SPDX 标识，README 对上游有链接与致谢。

这些措施不支持“内存立即销毁”的强保证：JavaScript 对象释放依赖垃圾回收，接口当前是完整缓冲读取；也不能由源码证明平台日志、访问日志和所有生产配置的留存策略。应把“不主动持久化内容”和“可验证的数据清除保证”分开描述。

### 7.3 未做的部署验证

未读取或变更 Cloudflare 生产账户、WAF、速率限制、日志留存、部署记录或域名配置；未扫描生产站点，未负载测试。因此不把“代码中未配置限流”写成“线上没有限流”，也不判断线上现部署是否与本地 HEAD 相同。

## 8. 文档修订清单

| 文档说法 | 本次证据 | 建议表述/修改 |
|---|---|---|
| 100% 严密数值对齐、零误差 | PDF 提取和 DSP 有反例；测试本身使用容差 | 写清基准提交、支持输入范围、对照字段、容差和实测通过的案例数 |
| 默认脱敏 | API、SVG 默认含身份 | 修代码并增加导出隐私测试；未修复前不能保留此声明 |
| 15 个原生测试全通过 | 当前实际为 30 pass / 1 skip | 更新数量，最好避免把易过时数量写成保证 |
| 19 个合成用例，含 PR/QTc/报警全对齐 | 当前是 18 个合成 + 1 个本机真实用例，覆盖字段不全 | 区分合成与私人可选测试，列实际覆盖范围 |
| 直接运行 pytest 即完成 HTTP 验证 | 无服务时整组 skip | 明确先启动服务、Python 依赖与基准路径；CI 中服务缺失应失败 |
| Node ≥20 | 锁定 Wrangler 最低 22 | 统一支持范围 |
| 毫秒级、内存流式、分析即焚 | 未见边缘性能基准；使用完整 arrayBuffer 和 inflate；无显式清零 | 写实际处理方式与已验证的性能分位，不承诺立即销毁 |
| O(N log W) 中值滤波 | sorted array + splice 为 O(NW) 最坏复杂度 | 修说明或换算法 |
| 标准毫米网格 / A4 医疗打印 | 当前是响应式、逐行自动缩放 SVG；无固定打印物理尺寸 | 标明按数值坐标阅读；若保留标准纸速承诺则增加定标打印模式及验收 |
| 载入实测样本 | `public/sample_ecg.pdf` 与 synthetic fixture 字节完全相同 | 改为“合成示例”，避免让用户误以为是真实验证记录 |
| 自动存相册 / 官方快捷指令 | 仓库只提供外链，没有可审查的快捷指令源或端到端验收记录 | 说明由快捷指令流程实现；补充可导出的流程说明及 iOS 验收条件；本次未验证外链流程 |
| 所有量均来自完整记录 | 内容流拆分可能截短 | 在报告中加入覆盖时长、行数和提取质量，并拒绝不完整输入 |

还应补齐：JSON 字段和 nullable 规则、错误码、支持/不支持 PDF 特性、参数校验、sex/placement 的实际作用、文件限制、隐私的数据流、外部验证的适用范围及已知局限。Python README 已明确单导联、短时 HRV、光栅偏差、某些异常漏检及形态缺乏外部真值，Web 文档不应在移植时省略这些解释。

## 9. 建议修复顺序及验收门槛

### 第一批：恢复可用并保护报告解释

1. 修 F01；浏览器 smoke 覆盖上传、示例、无 console error。
2. 修 F02；默认 JSON/SVG/PNG 不包含合成身份，显式开启时一致包含。
3. 修 F03；单/多内容流相同可见 PDF 的覆盖范围及心搏数一致，不完整输入明确拒绝。
4. 修 F04/F05/F07/F08；页面、SVG、JSON 共用结构化评估状态；跳过评估不得标全面正常。
5. 修 F06；全部内部输入扩展有硬上限。

### 第二批：让验证可重复

1. 修 F09/F13/F14；运行版本统一，CI 真正运行 HTTP 与浏览器检查。
2. 修 F10/F11；逐层比较提取、清洗、定位、形态，确定可接受容差；严格相等和业务等价分开验收。
3. 补 10 类形态异常、低可信度、性别/位置/排除参数的 PDF 全链路测试。
4. 清理 F17 硬编码身份；所有公开 fixture 保持合成。

### 第三批：完成产品与文档一致性

补页面分析选项，修报告 schema、时间、错误码和低优先级显示问题；准确说明光栅/批量/CSV 差异。对移动端、Safari、打印和快捷指令补实机验收，再更新 README 的性能和能力声明。

不建议在仅修掉语法错误后就将当前版本称为完成修复：F03 与 F04/F05 属于“界面能用但结果可能不完整或解释错误”的独立问题。

## 10. 本次审查的边界

- 所有新增动态数据均来自合成波形；未使用私人健康记录。
- 没有重新跑 MIT-BIH 全数据集，也没有复算原 README 的外部精度指标。
- 没有完成桌面浏览器截图、Safari/iOS、触屏、屏幕阅读器、A4 实物打印和快捷指令安装验收。代码中还可见请求取消/竞态、键盘上传入口和固定滚动坐标的改进空间，需在 UI 阻断修复后实测，而不是据静态阅读判定所有布局失败。
- 本地构建通过不等于线上部署成功；本次结果绑定上述本地提交，不代表远程生产版本。
- 新增审查脚本是复现工具，不是已经接入 CI 的回归测试套件；后续应把有代表性的断言整理为维护中的正式测试。

整体判断：核心 TypeScript 分析移植值得保留，已有合成回归提供了有效基础。优先把输入完整性、隐私默认值、可信度显示和验证门槛补齐，才能使网页版输出与 Python 的实际承诺一致。
