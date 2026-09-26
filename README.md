# Golf Green Vision

高尔夫球场移动端现场测试原型。

## 当前推进方式
项目按独立 Codex Thread 推进：

- Thread 00：项目初始化
- Thread 01：定位核心
- Thread 02：球场数据与洞号识别
- Thread 03：球道视图与距离
- Thread 04：轨迹记录与校准
- Thread 05：职业转播风格果岭视图
- 现场测试前：总审查

## 模型选择
本仓库不固定 Codex 模型或推理强度。

每个 Thread 由用户根据任务复杂度手动选择模型。

## 默认技术方向
- Vite
- React
- TypeScript
- Vitest
- 浏览器 Geolocation API
- GeoJSON
- 本地存储
- SVG 果岭可视化

实际工程选择以每个阶段的验证结果为准。

## 本地开发

安装依赖：

```bash
npm install
```

启动开发服务器：

```bash
npm run dev
```

运行测试：

```bash
npm test
```

生产构建：

```bash
npm run build
```
