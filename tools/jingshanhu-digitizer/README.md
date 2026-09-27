# 净山湖候选审查工作台

这是 Thread 03D 的轻量静态审查入口。它读取：

- `data/derived/jingshanhu/orthophoto_2023_preview_small.jpg`
- `data/derived/jingshanhu/orthophoto_2023_metadata.json`
- `data/derived/jingshanhu/spatial-candidates.json`

工作台使用原始影像像素坐标绘制 Green、Tee zone、corridor 和 OSM 辅助对象，并在侧栏显示 Top 3 全局方案、18 洞映射、候选证据、替代方案、冲突、转场和 WGS84 中心点。缩放、平移、候选点击、图层开关、方案切换、备注和“待现场确认”状态都在浏览器端完成。

## 数据兼容

工作台优先读取未来全局匹配输出中的 `globalSolutions`（也兼容 `global_solutions`、`solutions`、`globalMatching.solutions` 等命名），每套方案最多显示前三套，并兼容 `holeMappings`、`mappings`、`assignments` 以及 `teeZone`、`green`、`corridor`、`transition` 等字段变体。Green 分类兼容 `greenClassifications` / `green_candidates`，Tee zone 兼容 `teeZones` / `tee_zone_candidates`。

如果 JSON 仍是 V0.5 的 `holes[].bestCandidate` + `alternatives` 结构，工作台会生成一个只读的“兼容方案：逐洞候选”。这个兼容方案只为查看，不会把逐洞贪心候选解释成全局解，也不会写回 JSON；没有分类或 Tee zone 字段时明确显示为 unknown / 当前 JSON 没有记录。

候选面板和方案摘要中的“候选排序分 / 总排序分”只用于候选排序，不代表正确概率。方案摘要会显示 transition cost、feature-match score、冲突数量和未确定洞数量；18 洞表会显示每洞的状态、Tee zone → Green、corridor、分数和到下一洞的转场成本。现场确认入口中，“正确”记录 `actualHole = predictedHole`；选择“不是这个洞”后可保存实际 Hole 1–18 或“不确定”。现场坐标可由 GPS 填入，也可以留空；事件仍保存预测洞、实际洞、来源和时间。

## 启动

在项目根目录运行 `npm run dev`，然后打开：

`http://localhost:5173/tools/jingshanhu-digitizer/`

也可以用任意静态 HTTP 服务托管项目根目录。直接以 `file://` 打开会因浏览器禁止跨目录 fetch 而无法读取 JSON。

## 状态边界

工作台不会把点击、备注或现场事件写回 `spatial-candidates.json`，也不会把任何洞自动变为 `field-confirmed`。浏览器本地存储只保留审查备注、待现场确认标记和现场确认事件；事件结构见 `src/course/fieldConfirmation.ts`，JSON 约束见 `data/derived/jingshanhu/field-confirmation-events.schema.json`。
