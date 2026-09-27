# 净山湖 V0.5 地理配准记录

更新日期：2026-09-26（UTC+8）

## 结果摘要

- 逐洞空间配准：`0/18`。
- `teeCenter`：`0/18`，全部为 `null`，`teeCenterStatus=unknown`。
- `greenCenter`：`0/18`，全部为 `null`，`greenCenterStatus=unknown`。
- `centerline`：`0/18`，全部为 `null`，`centerlineStatus=unknown`。
- `spatialConfidence`：18 洞全部为 `none`；`spatialVerified=false`。
- `estimated`：没有任何洞级坐标被标记为 estimated；本轮不把地图像素或未编号要素猜测成洞级坐标。
- Polygon：仍为 `0/18`，本轮不制作精细球道 Polygon。

## 新增数据结构

`GolfHoleProperties` 支持以下空间字段：

- `teeCenter: GeoJSONPoint | null`
- `greenCenter: GeoJSONPoint | null`
- `centerline: GeoJSONLineString | null`
- `spatialConfidence: high | medium | low | none`
- `spatialVerified: boolean`
- `spatialDigitization: none | manual | imported | field-survey`
- `spatialEstimated: boolean`
- `teeCenterStatus`、`greenCenterStatus`、`centerlineStatus`

三项空间字段的 provenance 均引用本文件；当前引用说明为“未编号、未数字化、未估算”，不是已配准坐标来源。

运行时坐标顺序为 `[经度, 纬度]`，统一声明 WGS84。

## 来源与判定

### Tiger Booking 图片

Tiger 页面公开的 4 张图片已保存到 `data/raw/tiger-01.jpg` 至 `data/raw/tiger-04.jpg`。内容是球场景观、果岭/沙坑和道路照片，不包含可识别的 1-18 洞逐洞球道示意图。因此图片只作为“已检查的非配准资料”，没有数字化坐标，也没有像素到经纬度转换。

### OpenStreetMap

Overpass 原始响应：`data/raw/osm-jingshanhu-golf.json`。

- 数据时间：`2026-09-26T10:01:51Z`。
- 结果：26 个 `golf=green` 面、2 个 `golf=tee` 面，以及球道范围内的障碍物/道路要素。
- 限制：所有 Green/Tee 都没有 `hole`、`ref` 或编号关系；无法把这些要素可靠对应到 Tiger 的第几洞。
- 坐标：按 OSM WGS84 经纬度读取，无 GCJ-02/BD-09 转换。
- 许可证说明：Overpass 响应保留 OSM 的 ODbL 版权声明。

因此 OSM 只能作为绝对位置和空间形状参考，不能单独产生洞级 Tee/Green/centerline。

## 校验规则

`src/course/validation.ts` 新增：

- 所有 Point/LineString 坐标必须是合法经纬度；
- Tee 与 Green 中心相距不足 1 米时报错；
- centerline 至少有两个点，首尾必须按 Tee→Green 方向落在 50 米容差内；
- centerline 或 Tee→Green 直线距离与公开码数做数量级检查，保留 dogleg 允许直线距离较短的余量；
- 已有空间数据的相邻洞若所有端点均相距超过 1.8 公里，报告可疑相邻洞；
- 已提供的空间字段必须有 provenance 引用。

当前 18 洞均为空，因此这些规则不会把未编号参考要素误判为已配准。

## 当前可用性与风险

V0.5 仍不能用于真实 GPS 自动洞号识别或到果岭距离计算。最大风险是把 OSM 未编号 Green/Tee 与逐洞表的 1-18 洞进行错误关联；在取得带洞号的公开球道图、官方授权图或现场采样前，不应填入洞级坐标或标记 verified。

## 2023 正射影像到手后的候选配准阶段（Thread 03C）

2023 正射影像已按实际文件内容核验并通过预处理：5852 × 6063、四波段 UInt8、约 0.257571 m/pixel，源 CRS 为 EPSG:4548（CGCS2000 / 3-degree Gauss-Kruger CM 117E），运行时仍统一使用 EPSG:4326/WGS84。GeoTIFF、PRJ、TFW 的一致性和 TFW 半像元语义记录在 [`jingshanhu_orthophoto_2023.md`](./jingshanhu_orthophoto_2023.md)。

本阶段不要求不熟悉球场的用户凭经验给 18 个对象编号，而是生成可审查的未编号空间对象和 Hole 候选：26 个 Green、2 个 Tee、55 个 Bunker、12 个 Water、23 个 Cartpath、14 个 Rough，以及 52 条 Tee→Green 直线长度比较 proxy。结果保存在 `data/derived/jingshanhu/spatial-candidates.json`；`Gxx/Txx/Cxx` 等 ID 只是空间对象 ID，不代表洞号。

18 洞目前全部是 `candidate`；`unknown=0`、`high-confidence-inferred=0`、`field-confirmed=0`。每洞保留 bestCandidate、4 个 alternatives、长度/Par evidence、conflicts、来源和限制。分数只用于解释排序，且封顶 0.68；没有将任何候选写入正式 `course.geojson` 的 Tee、Green、centerline 或 Polygon。`Cxx` 明确不是实际球道 centerline，dogleg 只允许直线距离作为数量级检查。

审查工作台和现场确认事件结构为下一次真实下场准备入口：用户可以查看候选、标记“待现场确认”和写备注，但点击候选不会自动成为 `field-confirmed`。现场确认需独立记录时间、预测洞号、实际洞号、WGS84 位置和 `field`/`familiar-player`/`official` 等来源。
