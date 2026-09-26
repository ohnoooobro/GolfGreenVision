# 净山湖 V0 数据集

## 目标

建立第一次真实现场测试使用的北京净山湖高尔夫俱乐部数字底稿。V0 优先验证资料来源、洞号识别数据接口和现场采样流程，不宣称达到官方测绘精度。

## 当前覆盖

- 洞号：1-18 均已建立，来源为 Tiger Booking 公开球道表。
- Par：18 洞均有值，合计 72；状态为 `unverified`，等待球场记分卡或现场核对。
- 四档距离：18 洞均记录 Gold、Blue、White、Red 码数；Tiger 表的档位名称和总长度存在冲突，状态为 `unverified`。
- Polygon：0/18。所有 `geometry` 为 `null`，`polygonStatus` 为 `unknown`。
- 果岭中心：0/18。所有 `greenCenter` 为 `null`，`greenCenterStatus` 为 `unknown`。
- 洞号存在性：1-18 可用于手动 correctedHole 选项；这不等于几何已验证。

## 采用的来源

详细调查见 [`jingshanhu_sources.md`](./jingshanhu_sources.md)。运行时真正消费的精简对象位于 `src/course/jingshanhuCourse.ts`，交换格式副本位于 `data/derived/jingshanhu/course.geojson`。

## 验证与推断状态

`holeNumberVerified` 只表示公开表格明确列出了 1-18 洞。Par、距离均为第三方公开资料，未取得官方记分卡交叉确认，故标记 `unverified`。没有人工数字化的 Polygon 或估算果岭中心；缺失值保持 `null`，不伪装成实测或影像估算。

## 不能用于什么

V0 不能用于自动根据 GPS 判断净山湖当前洞号，不能计算到果岭距离，不能作为官方测绘、导航、比赛记分或安全边界数据，也不能替代球场提供的当日球道/发球台信息。

## V1 计划

第一次现场测试先记录球场实际使用的洞序、发球台、发球台与果岭采样点和 GPS accuracy。获得现场授权或可复核影像后，再按洞逐一数字化宽松 Polygon 与果岭中心，记录每个几何的来源、采集日期、CRS 和验证人；完成相邻洞边界与边界点测试后再发布 V1。
