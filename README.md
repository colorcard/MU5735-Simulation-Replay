# MU5735 ADS-B + FDR 最后 2 分钟回放

这是一个围绕 MU5735 事故最后 2 分钟构建的网页回放项目。网页主时间轴采用 ADS-B Reveal 的末段记录，前约 26.8 秒与本地 FDR 导出数据重叠；其后进入纯 ADS-B 段，只保留公开外部轨迹与严格派生量。

## 项目结构

```text
webapp/
├─ app/                 # React + Vite 网页
├─ tools/               # 数据处理脚本
├─ data/
│  ├─ raw/              # 原始输入
│  ├─ processed/        # 融合/对齐后的中间结果
│  └─ web_payload/      # 网页直接消费的 JSON/JS 载荷
├─ package.json
└─ README.md
```

## 数据源

### 1. FDR 本地导出

位于 `data/raw/fdr/`：

- `ExactSample.csv`
  主要 FDR 数值与状态导出，包含姿态、控制输入、发动机、燃油流量等。
- `TableResolution.csv`
  用于补充和识别部分表格型导出记录，同时用于识别占位/残影段。

### 2. ADS-B Reveal / FR24 原始输入

位于 `data/raw/adsb_reveal/`：

- `Merged Data.xlsx`
  来自公开仓库 `ErnestThePoet/MU5735-ADSB-Reveal` 的整合工作簿。
- `Flightradar24 Granular Data.csv`
  同仓库附带的 FR24 细粒度记录，用于补充时间对齐与外部轨迹字段。
- `README.md`
  原仓库说明。
- `LICENSE`
  原仓库许可证。

## 处理链

### 步骤 1：标准化 ADS-B Reveal 数据

脚本：

- `tools/build_adsb_reveal_csv.py`

输入：

- `data/raw/adsb_reveal/Merged Data.xlsx`
- `data/raw/adsb_reveal/Flightradar24 Granular Data.csv`

输出：

- `data/processed/MU5735_ADSB_reveal_fused.csv`

处理方式：

- 解析 Reveal 工作簿中的 `track` / `crash` 两张表。
- 将时间统一到 CST 本地时间与 UTC。
- 合并经纬度、高度、地速、垂速、航向等字段。
- 用 FR24 粒度数据做最近邻补充与匹配标记。

### 步骤 2：ADS-B 与 FDR 二次对齐

脚本：

- `tools/build_fdr_adsb_aligned_csv.py`

输入：

- `data/processed/MU5735_ADSB_reveal_fused.csv`
- `data/raw/fdr/ExactSample.csv`
- `data/raw/fdr/TableResolution.csv`

输出：

- `data/processed/MU5735_FDR_ADSB_aligned.csv`
- `data/processed/MU5735_FDR_ADSB_overlap.csv`
- `data/processed/MU5735_FDR_ADSB_last5min_aligned.csv`
- `data/processed/MU5735_FDR_ADSB_alignment_meta.json`

处理方式：

- 以高度、地速、航向三项为主，做加权时间偏移拟合。
- 将 ADS-B 时间轴映射到 FDR 绝对时间。
- 对 FDR 数值字段做观测/插值/缺失标记。
- 对 `TableResolution.csv` 中明显占位值做过滤，不把伪影当作真实观测。

### 步骤 3：生成网页 2 分钟回放载荷

脚本：

- `tools/build_mu5735_web_last2min.py`

输入：

- `data/processed/MU5735_FDR_ADSB_aligned.csv`
- `data/raw/fdr/ExactSample.csv`
- `data/raw/fdr/TableResolution.csv`

输出：

- `data/web_payload/mu5735_last2min_fused.json`
- `data/web_payload/mu5735_last2min_fused.js`

处理方式：

- 以 ADS-B 末条记录向前回溯 120 秒，构建 0.05 秒采样网格。
- 在 FDR 重叠段内插值姿态、控制和发动机参数。
- 对残影/占位区显式标记，不做伪造连续补段。
- FDR 终止后仅保留 ADS-B 可直接观测字段与严格派生量。
- 生成时间轴事件、质量标注、范围统计和网页所需元数据。

## 网页内容

`app/` 是当前实际部署的 React + Vite 前端，默认读取：

- `data/web_payload/mu5735_last2min_fused.json`

网页当前展示重点：

- ADS-B 时间轴下的最后 2 分钟回放
- FDR / 纯 ADS 段边界标注
- 高度 / 地速主图
- 俯仰 / 横滚 / 滚转率
- 操纵输入
- Cutoff / Fuel Flow / N2 事故链证据图
- 当前状态、数据质量与方法说明

## 常用命令

安装依赖：

```bash
npm install
```

仅同步网页载荷到前端静态目录：

```bash
npm run sync:data
```

重建整条数据链：

```bash
npm run rebuild:data
```

启动开发环境：

```bash
npm run dev
```

构建部署产物：

```bash
npm run build
```

本地预览部署产物：

```bash
npm run preview
```

## Git 仓库建议

如果你要把这个目录单独作为仓库，直接在 `webapp/` 下执行：

```bash
git init
git add .
git commit -m "Initial MU5735 web replay project"
```
