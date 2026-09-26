import type { GolfCourseGeoJSON } from './types'

/**
 * Mock / Demo 球场，仅用于开发和测试验证。
 * 坐标为人为设计的 WGS84 示例，不代表任何真实球场。
 */
export const mockDemoCourse: GolfCourseGeoJSON = {
  type: 'FeatureCollection',
  properties: {
    id: 'mock-demo-course-3-holes',
    name: 'Mock Demo Course（模拟数据）',
    source: 'Mock / Demo synthetic fixture; not a real course',
    coordinateSystem: 'WGS84',
    verified: false,
    demo: true,
  },
  features: [
    {
      type: 'Feature',
      properties: {
        hole: 1,
        par: 4,
        greenCenter: { type: 'Point', coordinates: [120.0007, 30.0005] },
        source: 'Mock / Demo synthetic fixture; not a real course',
        verified: false,
      },
      geometry: {
        type: 'Polygon',
        coordinates: [[[120, 30], [120.001, 30], [120.001, 30.001], [120, 30.001], [120, 30]]],
      },
    },
    {
      type: 'Feature',
      properties: {
        hole: 2,
        par: 3,
        greenCenter: { type: 'Point', coordinates: [120.0015, 30.0005] },
        source: 'Mock / Demo synthetic fixture; not a real course',
        verified: false,
      },
      geometry: {
        type: 'Polygon',
        coordinates: [[[120.0008, 30], [120.0018, 30], [120.0018, 30.001], [120.0008, 30.001], [120.0008, 30]]],
      },
    },
    {
      type: 'Feature',
      properties: {
        hole: 3,
        par: null,
        greenCenter: { type: 'Point', coordinates: [120.0023, 30.0005] },
        source: 'Mock / Demo synthetic fixture; not a real course',
        verified: false,
      },
      geometry: {
        type: 'Polygon',
        coordinates: [[[120.0016, 30], [120.0026, 30], [120.0026, 30.001], [120.0016, 30.001], [120.0016, 30]]],
      },
    },
  ],
}

