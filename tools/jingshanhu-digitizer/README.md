# 净山湖候选审查工作台

这是 Thread 03C 的轻量静态审查入口。它读取：

- `data/derived/jingshanhu/orthophoto_2023_preview_small.jpg`
- `data/derived/jingshanhu/orthophoto_2023_metadata.json`
- `data/derived/jingshanhu/spatial-candidates.json`

工作台使用原始影像像素坐标绘制 Green、Tee、corridor 和 OSM 辅助对象，并在侧栏显示候选证据、冲突和 WGS84 中心点。缩放、平移、候选点击、备注和“待现场确认”状态都在浏览器端完成。

## 启动

在项目根目录运行 `npm run dev`，然后打开：

`http://localhost:5173/tools/jingshanhu-digitizer/`

也可以用任意静态 HTTP 服务托管项目根目录。直接以 `file://` 打开会因浏览器禁止跨目录 fetch 而无法读取 JSON。

## 状态边界

工作台不会把点击、备注或现场事件写回 `spatial-candidates.json`，也不会把任何洞自动变为 `field-confirmed`。浏览器本地存储只保留审查备注、待现场确认标记和现场确认事件；事件结构见 `src/course/fieldConfirmation.ts`，JSON 约束见 `data/derived/jingshanhu/field-confirmation-events.schema.json`。
