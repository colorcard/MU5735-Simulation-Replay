# MU5735 ADS-B + FDR 最后 2 分钟回放

这个项目基于 MU5735 **公开 ADS-B 记录**与 **FOIA 公布的 FDR 导出数据**，构建了 ADS-B + FDR 融合数据到 Web 端的**最后 2 分钟**的模拟回放。

回放主时间轴以 ADS-B Reveal 末条记录为基准，向前回溯 120 秒；其中窗口前约 26.8 秒与 FDR 有限重叠，后段进入纯 ADS-B 区间。因此姿态、操纵、发动机等 FDR 专属量只在重叠段内可见，后段仅保留 ADS-B 可支撑的外部运动信息和严格派生量。

> [!TIP]
> 本模拟回放展示仅供参考，仅为学习交流，不代表任何正式结论，一切以官方结果为准。

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

项目中，一部分位于 `data/raw/fdr/`，包含 FOIA 公布的 FDR 导出数据：`ExactSample.csv` 提供姿态、控制输入、发动机与燃油流量等核心字段，`TableResolution.csv` 用于补充表格信息，并辅助识别异常或占位记录。

另一部分位于 `data/raw/adsb_reveal/`，包含来自 ErnestThePoet/MU5735-ADSB-Reveal 的 ADS-B 数据，包括 `Merged Data.xlsx`、`Flightradar24 Granular Data.csv` 及其说明与许可证文件。

`tools/build_adsb_reveal_csv.py` 负责解析 Reveal 工作簿中的 `track` 与 `crash` 工作表，统一时区后整合经纬度、高度、地速、垂速与航向等字段，并结合 FR24 粒度记录做最近邻补充，生成融合后的 ADS-B 数据。

`tools/build_fdr_adsb_aligned_csv.py` 进一步以高度、地速和航向为主进行加权时间偏移拟合，将 ADS-B 时间映射到 FDR 的绝对时间轴，同时输出对齐结果、重叠区数据以及对应的元信息文件。

`tools/build_mu5735_web_last2min.py` 则从对齐结果中提取最后两分钟数据，并按 0.05 秒采样网格重构为前端使用的 JSON/JS 载荷，同步到 `app/public/data/` 目录。

## 其中使用到的数据源：

FDR 导出数据来源： [wrongly-cuddly-obsession/NTSB_FOIA_MU5735](https://github.com/wrongly-cuddly-obsession/NTSB_FOIA_MU5735)

ADS-B 数据来源：[ErnestThePoet/MU5735-ADSB-Reveal](https://github.com/ErnestThePoet/MU5735-ADSB-Reveal)