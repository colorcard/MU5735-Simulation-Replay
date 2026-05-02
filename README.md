# MU5735 ADS-B + FDR 最后 2 分钟回放

这个项目提供一个基于 MU5735 末段公开 ADS-B 记录与本地 FDR 导出重叠段构建的网页回放。

回放主时间轴采用 ADS-B Reveal 末条记录向前回溯 120 秒；窗口前约 26.8 秒与 FDR 有限重叠，后段进入纯 ADS-B 区间，因此姿态、操纵、发动机等 FDR 专属量只在重叠段内可见，后段仅保留 ADS-B 可支撑的外部运动信息和严格派生量。

## 目录

```text
webapp/
├─ app/                 React + Vite 前端
├─ tools/               数据处理脚本
├─ data/
│  ├─ raw/              原始输入
│  ├─ processed/        对齐与融合后的中间结果
│  └─ web_payload/      网页直接读取的回放载荷
├─ package.json
└─ README.md
```

## 数据与处理链

原始数据分两部分。`data/raw/fdr/` 下的 `ExactSample.csv` 与 `TableResolution.csv` 提供本地 FDR 导出，其中前者包含姿态、控制输入、发动机和燃油流量等主要字段，后者用于补充表格型导出并辅助识别异常/占位记录。`data/raw/adsb_reveal/` 下保存来自 `ErnestThePoet/MU5735-ADSB-Reveal` 的 `Merged Data.xlsx`、`Flightradar24 Granular Data.csv` 及其原始说明和许可证。

处理链分三步。`tools/build_adsb_reveal_csv.py` 解析 Reveal 工作簿中的 `track` / `crash` 工作表，统一时区，合并经纬度、高度、地速、垂速、航向等字段，并利用 FR24 粒度记录做最近邻补充，输出 `data/processed/MU5735_ADSB_reveal_fused.csv`。`tools/build_fdr_adsb_aligned_csv.py` 以高度、地速、航向三项为主做加权时间偏移拟合，将 ADS-B 时间映射到 FDR 绝对时间，输出 `MU5735_FDR_ADSB_aligned.csv`、`MU5735_FDR_ADSB_overlap.csv`、`MU5735_FDR_ADSB_last5min_aligned.csv` 和 `MU5735_FDR_ADSB_alignment_meta.json`。`tools/build_mu5735_web_last2min.py` 再从对齐结果中提取最后 2 分钟，按 0.05 秒采样网格生成网页载荷 `data/web_payload/mu5735_last2min_fused.json` 与 `data/web_payload/mu5735_last2min_fused.js`，并同步到 `app/public/data/` 供前端直接读取。

这条处理链的核心原则是时间轴统一、来源分层和缺失显式化：FDR 重叠段内允许观测值与短时插值，异常/占位段单独标记，FDR 终止后不再延伸姿态、操纵或发动机记录。

## 网页功能

网页前端位于 `app/`，默认加载 `data/web_payload/mu5735_last2min_fused.json`。页面顶部给出回放范围、关键关断信息、窗口说明以及播放控制；主时间轴嵌入 Cutoff 切换、N2 衰减、燃油近零、FDR 终止、进入纯 ADS 段以及高度/地速门槛等事件，并显式标出异常记录区和纯 ADS 区间。左侧区域展示操纵与系统状态，包括操纵杆、操纵盘、舵面反馈、Cutoff 开关和双发即时状态；中部姿态示意区给出俯仰、横滚、高度、地速、航向和下沉率等当前快照；核心图表区集中呈现高度/地速、俯仰/横滚/滚转率、操纵输入，以及 Cutoff SW / Fuel Flow / N2 的发动机相关记录。展开区进一步提供双发 N2、双发燃油流量细节曲线、当前状态摘要、数据质量标记和说明文本。

网页对外展示时遵循数据真实性约束：纯 ADS 段不伪造 FDR 姿态、操纵或发动机数据；异常/占位区不被包装成连续观测；只有真实记录或严格插值可支撑的曲线才会显示。