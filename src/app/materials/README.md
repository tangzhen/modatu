# materials — 原始材料数据归档（独立 folder，app 代码零引用）

本目录存放嘉立创（JLC FA 型材设计器）采集的原始材料事实与厂家原始文件。
**app（web/server 打包产物）不直接加载本目录任何文件**——只在 `npm run seed` 时
由服务端脚本（`apps/server/src/seed/materials.ts`）读取并导入数据库。

## 目录结构

```
materials/
  README.md                 ← 本文件
  jlc/
    captured-at.json        ← 采集元数据（日期、端点、认证方式；不含签名 URL）
    api/
      catalog-tree.json     ← 型材目录树（系列 → 槽宽 → 规格，欧标/国标）
      section-list.json     ← 151 个产品的清单（颜色/米重/米价/壁厚/料号/库存）
      section-records.json  ← 每个产品的截面记录（w/h、DXF/JSON 文件路径——签名已剥除）
      texture-finishes.json ← 6 种颜色资产的名称/料号事实（本色/黑色/白色/原木色/银白氧化/喷砂电泳）
    profiles/
      <MODEL>/<MODEL>.dxf          ← 厂家截面 DXF（AC1014，单位 mm）
      <MODEL>/section-config.json  ← 厂家语义截面配置（每面槽宽/深、芯孔直径——行业标准事实）
```

## 版权与使用边界

- **只存**：行业标准尺寸事实（宽高/槽宽/槽深/壁厚/芯孔）、米重、未税米价、颜色名称与
  欧标料号，以及厂家原始 DXF/语义 JSON 作几何参考（`captured-at.json` 记录采集日期）。
- **不存**：签名 OSS URL（约 1 小时过期，已全部剥除）；**不复制**：颜色贴图 PNG、
  产品渲染图 JPG（受版权保护的渲染资产，不入库、不进产品）。
- 产品内的颜色渲染用 Modatu 自选的代表性 hex 色（见 `apps/server/src/seed/materials.ts`
  的 `FINISH_HEX` 映射），非嘉立创贴图。

## 采集方式（复现步骤）

1. 浏览器打开 `https://xc.jlcfa.com/free-design`（SPA 外壳 + 同源 iframe `profile-editor`）。
2. 匿名会话可用：从 cookie 取 `XSRF-TOKEN`，作为 `X-XSRF-TOKEN` 请求头回传即可调 API。
3. 核心端点（均需 `Content-Type: application/json` + XSRF 头）：
   - `POST /api/fa-platform/profile/free-designer/product/section-list`
     body `{catalogBizKeys:[],pageNum:1,pageSize:200,searchWord:null,sortColumn:3}`
     → 全部产品 + `materials[]`（color/meterWeight/meterPrice/profileCode/thickness）
   - `GET /api/fa-platform/profile/free-designer/tree?catalogType=2` → 目录树
   - `POST /api/fa-platform/profile/cad/section` body `{bizKeys:[...],profileProductModels:[]}`
     → 每产品 `dxfFile/jsonFile` 的 OSS 路径 + `w/h` + `materials[]`
   - `POST /api/fa-platform/profile/cad/texture` body `{bizKeys:[<textureProfileProductBizKey>]}` → 颜色资产名
4. OSS 文件直链下载（publicReadFilePath）。DXF 实测 AC1014/`$INSUNITS=4`(mm)，
   仅 LINE+ARC，图层即语义：`outer` 自回环外轮廓 + `inner1..N` 孔洞。

## seed 导入的规格子集

原始归档保留全量 151 规格；`npm run seed` 只导入主流欧标子集
（2020 / 2040 / 3030 / 3060 / 4040，见 `apps/server/src/seed/materials.ts` 的
`MODATU_CODES`），其余规格数据留作后续扩充参考。
