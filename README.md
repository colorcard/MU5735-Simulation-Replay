# MU5735 ADS-B + FDR 最后 2 分钟回放

这是一个围绕 MU5735 事故末段数据构建的网页回放项目。它把公开 ADS-B Reveal 记录与本地 FDR 导出做时间对齐和分层融合，最终生成一个可直接浏览的末两分钟动态回放，用来观察高度、地速、操纵输入、发动机状态以及 FDR 结束后的纯 ADS-B 轨迹延续。

回放主时间轴以 ADS-B Reveal 最后一条记录为终点，向前回溯 120 秒。窗口前段约 26.8 秒与 FDR 存在有限重叠，因此这一段能够展示姿态、操纵和发动机等机载记录；当时间轴进入纯 ADS-B 区间后，页面只保留高度、地速、航迹和严格派生量，不对缺失的 FDR 量做伪造补齐。

## 结构

仓库分成三个主要部分：`app/` 是 React + Vite 前端，`tools/` 是数据处理脚本，`data/` 保存原始输入、中间结果和供网页直接加载的回放载荷。这样拆分后，网页、处理工具和数据来源彼此独立，后续无论是继续补充数据链，还是直接部署静态页面，都比较清晰。

## 数据来源与处理

原始数据来自两条链路。`data/raw/fdr/` 下的 `ExactSample.csv` 与 `TableResolution.csv` 保存本地 FDR 导出，其中包含姿态、控制输入、发动机转速、燃油流量等字段，也保留了表格型导出里用于识别异常记录和占位值的信息。`data/raw/adsb_reveal/` 下则放置了来自 `ErnestThePoet/MU5735-ADSB-Reveal` 的 `Merged Data.xlsx`、`Flightradar24 Granular Data.csv` 及相关说明文件，作为末段外部轨迹和速度信息的公开来源。

处理链分为三步。`tools/build_adsb_reveal_csv.py` 先解析 Reveal 工作簿中的 `track` 和 `crash` 工作表，统一时间基准，整理经纬度、高度、地速、垂速、航向等字段，并结合 FR24 粒度数据做最近邻补充，输出 `data/processed/MU5735_ADSB_reveal_fused.csv`。`tools/build_fdr_adsb_aligned_csv.py` 再利用高度、地速和航向做加权时间偏移拟合，把 ADS-B 时间映射到 FDR 绝对时间，生成对齐主表、重叠段表、最后 5 分钟对齐表以及对应的元数据。最后，`tools/build_mu5735_web_last2min.py` 从对齐结果中抽取最后两分钟，按 0.05 秒采样网格构建网页载荷，并同步到 `app/public/data/` 供前端直接读取。

这条处理链的原则很简单：统一时间轴、区分来源层级、把缺失显式保留下来。重叠段内允许使用观测值和短时插值，但异常段会单独标注；FDR 终止后，姿态、操纵和发动机量不会被延展到纯 ADS-B 区间。

## 网页展示

网页默认加载 `data/web_payload/mu5735_last2min_fused.json`。页面顶部提供回放时间范围、关键系统事件和播放控制，主时间轴内直接嵌入 Cutoff 切换、N2 衰减、燃油接近归零、FDR 终止、进入纯 ADS-B 区间以及高度和地速门槛等节点，同时显式标出异常记录区和纯 ADS 区间，方便把“有机载记录支撑”和“只有外部轨迹支撑”的部分区分开看。

页面主体聚焦在几类信息上：一侧是操纵与系统状态，包括操纵杆、操纵盘、舵面反馈、Cutoff 开关和双发即时状态；另一侧是关键图表，集中展示高度/地速、俯仰/横滚/滚转率、操纵输入，以及与发动机关断有关的 Cutoff、Fuel Flow、N2 变化。细节区还会补充双发转速与燃油流量的分项曲线、当前时刻摘要和数据质量标记，尽量把“发生了什么”和“哪些量已经缺失”放在同一页面上交代清楚。

整个网页采用的展示约束是：只呈现真实记录，或者能够被当前数据严格支撑的派生量。纯 ADS-B 区间不会虚构 FDR 姿态和发动机参数，异常或占位记录也不会被包装成平滑连续的观测。

## 常用命令

```bash
npm install
npm run sync:data
npm run rebuild:data
npm run dev
npm run build
npm run preview
```

`npm run sync:data` 用于把网页载荷同步到前端静态目录；`npm run rebuild:data` 会从原始输入开始重跑整条数据链；`npm run build` 则把可部署的前端产物输出到 `dist/`。

如果你准备把当前目录直接作为独立仓库发布，初始化方式也很直接：

```bash
git init
git add .
git commit -m "Initial MU5735 web replay project"
```
