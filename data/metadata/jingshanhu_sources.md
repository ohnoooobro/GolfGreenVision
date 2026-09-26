# 净山湖公开资料调查

调查日期：2026-09-26（UTC+8）

## 逐洞图与图片

| 来源 | URL | 结果 | 处理 |
| --- | --- | --- | --- |
| Tiger Booking 球场页 | https://www.tigerbooking.com/zh/cn/golf-course/Jingshanhu-Golf-Club-TACN0279 | 页面有 18 洞表、Par、四档码数和 4 张公开图片 | 表格沿用 V0；图片通过公开 S3 镜像保存到 `data/raw/tiger-01.jpg` 至 `tiger-04.jpg`，查看后确认均为宣传/景观照片，不是逐洞球道图，不用于坐标配准 |
| Tiger 图片公开 S3 镜像 | https://agladmin.s3.ap-northeast-2.amazonaws.com/poi-prd/_files/poi/202503/67cff5f58862d.jpg（其余文件名见页面） | 可公开读取图片文件 | 仅作为“已检查但不采用”的资料留档，不把像素位置转换成经纬度 |

四张图片的公开镜像文件名分别为：`67cff5f58862d.jpg`、`67cff5fbb7f05.jpg`、`67cff6012ab5e.jpg`、`67cff60678e50.jpg`。

## 带坐标的公开地图

| 来源 | URL | 结果 | 处理 |
| --- | --- | --- | --- |
| OpenStreetMap Overpass | https://overpass-api.de/api/interpreter | 2026-09-26T10:01:51Z 数据中，球场范围内有 26 个 `golf=green` 面、2 个 `golf=tee` 面；这些要素没有 `hole`、`ref` 或编号关系 | 原始响应保存到 `data/raw/osm-jingshanhu-golf.json`，坐标按 OSM 的 WGS84 经纬度解释；只用于绝对位置和要素数量交叉核对，未分配给任何洞号 |
| OSM 球场范围查询 | https://overpass-api.de/api/interpreter | 返回 `leisure=golf_course`、名称“净山湖高尔夫俱乐部”的范围要素 | 原始响应保存到 `data/raw/osm-jingshanhu-overpass.json`，只作球场位置证据 |
| Bing Maps 地点卡片 | https://cn.bing.com/search?q=%E5%87%80%E5%B1%B1%E6%B9%96%E9%AB%98%E5%B0%94%E5%A4%AB | 约 40.1842613, 116.4317627 的球场级地点坐标 | 页面没有声明坐标系，不写入洞级运行时数据 |

## 逐洞表与冲突

- Tiger 页面提供 1-18 洞、总 Par 72 和四档距离；这些字段延续 V0 的 `unverified` 状态。
- Tiger 页面同时出现 7,489 meter、7,312 码和逐洞表合计差异；本轮不重新调查或改写 Par/距离，只把该页面作为空间配准的洞号语义来源。
- 百动 Bestdo 页面（https://weixin.bestdo.com/wx/item/info?mer_item_id=10200931000018）只作 18 洞/72 杆/7,312 码的场级交叉来源，没有逐洞空间数据。

## 坐标与转换

- 应用运行时坐标系统一声明为 WGS84，GeoJSON 顺序为 `[经度, 纬度]`。
- OSM Overpass 返回的 `lat`/`lon` 按 WGS84 使用，没有进行 GCJ-02 或 BD-09 转换。
- 未读取或混入高德坐标；没有发生坐标转换。

## 配准结论

公开地图能看到未编号的 Green/Tee 形状，但没有逐洞图或编号关系把它们和 Tiger 的 1-18 洞对应起来。将任意 Green 直接赋给某个洞会引入不可审计的猜测，因此 V0.5 不写入任何洞级 Tee、Green 或 centerline 坐标；这些字段保留 `null`，详细状态见 [`jingshanhu_v0_5.md`](./jingshanhu_v0_5.md)。
