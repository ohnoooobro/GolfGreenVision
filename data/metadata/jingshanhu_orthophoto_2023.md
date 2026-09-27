# 净山湖 2023 正射影像核验记录

更新日期：2026-09-27（UTC+8）

## 原始资料

输入归档为项目根目录的 `净山湖高尔夫球场2023.zip`。归档解压到 `data/raw/jingshanhu_orthophoto_2023/` 后，实际包含以下 5 个文件；原始文件保持不修改：

| 文件 | 类型 | 字节数 | 用途 |
| --- | --- | ---: | --- |
| `净山湖高尔夫球场2023.tif` | GeoTIFF | 144,708,423 | 四波段正射影像 |
| `净山湖高尔夫球场2023.tfw` | TFW | 74 | 外部 affine 参数核对 |
| `净山湖高尔夫球场2023.prj` | WKT/PRJ | 629 | 外部 CRS 核对 |
| `净山湖高尔夫球场2023.kml` | KML | 764 | 无洞号的球场范围参考 |
| `净山湖高尔夫球场2023.txt` | 文本（GBK） | 617 | 导出摘要核对 |

## GeoTIFF 元数据

- Raster 尺寸：5852 列 × 6063 行。
- 波段：4；顺序为 Red、Green、Blue、Alpha。
- 数据类型：4 个波段均为 UInt8，8 bit/sample。
- 地面分辨率：X/Y 均为 `0.2575710082 m/pixel`。
- GeoTransform：`[0.25757100823779566, 0, 450609.83013670344, 0, -0.25757100823779566, 4450632.294997172]`。
- 投影 CRS：`EPSG:4548`，`CGCS2000 / 3-degree Gauss-Kruger CM 117E`。
- 投影范围（源 CRS）：`x=450609.8301..452117.1357`，`y=4449070.6420..4450632.2950`。
- WGS84 覆盖范围（影像边界）：`west=116.4200220`，`south=40.1745409`，`east=116.4378373`，`north=40.1886916`。
- Alpha：第 4 波段存在；透明像元 448,447 个，部分透明像元 0，透明值为 0；GeoTIFF 没有单独 NoData 值。

程序读取的摘要保存在 [`orthophoto_2023_metadata.json`](../derived/jingshanhu/orthophoto_2023_metadata.json)。

## 三套地理信息的一致性

1. GeoTIFF 内嵌 CRS 和 PRJ 都解析为 EPSG:4548，投影参数一致。PRJ 外层是带零值 CGCS2000→WGS84 转换的 BoundCRS，比较时使用其中的投影源 CRS。
2. TFW 的 A/D/B/E 与 GeoTIFF 像元大小、旋转一致；C/F 与 GeoTIFF 的左上角像元角一致。
3. 该 TFW 的 C/F 不是常见的“左上角像元中心”语义，和标准像元中心相差半像元，约 `0.18213 m`。预处理脚本以 GeoTIFF affine 为准，并明确使用连续像元边界坐标；像元 `(column+0.5, row+0.5)` 才表示像元中心。
4. KML 只有一个 CGCS2000 地理坐标球场范围矩形，没有洞号、Tee、Green 或控制点。KML 仅作范围交叉检查，不能生成洞级坐标。
5. TXT 为 GBK 编码的导出摘要；尺寸、分辨率、源 CRS 和角点与 GeoTIFF/pyproj 结果一致。它写出的经纬度角点是范围摘要，不替代 affine 变换。

## 坐标转换与预处理

可复现脚本为 [`scripts/prepare_jingshanhu_orthophoto.py`](../../scripts/prepare_jingshanhu_orthophoto.py)，依赖见 [`requirements-orthophoto.txt`](../../requirements-orthophoto.txt)。脚本：

1. 使用 rasterio 读取 GeoTIFF、波段、alpha、affine、CRS 和边界；
2. 使用 pyproj 按实际 EPSG:4548 将源 CRS 转换为 EPSG:4326/WGS84，`always_xy=True`；
3. 生成完整预览（本地审查用，Git 忽略）和最长边 1024 像素的轻量预览；
4. 输出小型 JSON 元数据，并测试四角、中心点的 pixel→source→WGS84→source→pixel round-trip；
5. 预览只用于浏览和叠加审查，不能把像素坐标直接当经纬度。

### Datum 与绝对精度限制

当前 EPSG:4548 → WGS84 使用 pyproj 可用转换，尚未通过现场控制点、RTK 或其他独立基准验证。因此它可以用于当前 PoC 的范围叠加、候选审查和坐标链路测试，但不得宣称厘米级或亚米级绝对地理精度。正射影像自身约 `0.26 m/pixel` 只表示像元采样分辨率，不等于最终 WGS84 绝对坐标也具有同等精度。

OSM 对象本身已是 WGS84；候选生成器只把 WGS84 对象反算到 EPSG:4548 affine 形成影像叠加像素，运行时几何仍为 WGS84。没有使用 GCJ-02 或 BD-09，也没有对 RGB 影像解释高程、坡度或果岭倾斜。

## Git 与使用边界

原始 ZIP、GeoTIFF、解压目录、完整预览、tiles、cache 和临时 GIS 输出均由 `.gitignore` 排除；Git 只保存小型 metadata、轻量预览、脚本和候选 JSON。候选数据只表达未编号 OSM 空间对象及可解释排序，不代表 1-18 洞已配准。
