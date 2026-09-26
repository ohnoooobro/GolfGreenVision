import type { GolfCourseGeoJSON, TeeYardages } from './types'

const HOLE_TABLE: Array<[par: number, gold: number, blue: number, white: number, red: number]> = [
  [4, 393, 350, 296, 267], [4, 405, 360, 326, 303], [5, 543, 522, 497, 422],
  [4, 453, 412, 373, 317], [4, 408, 379, 348, 276], [3, 223, 200, 174, 147],
  [5, 575, 547, 518, 469], [4, 359, 328, 302, 269], [3, 200, 176, 152, 121],
  [5, 603, 576, 522, 481], [4, 358, 325, 301, 274], [3, 217, 156, 156, 135],
  [4, 458, 446, 420, 403], [4, 488, 461, 440, 398], [5, 609, 575, 530, 469],
  [4, 318, 298, 276, 252], [3, 168, 168, 145, 141], [4, 380, 352, 322, 275],
]

const source = 'Tiger Booking hole table'
const sourceUrl = 'https://www.tigerbooking.com/zh/cn/golf-course/Jingshanhu-Golf-Club-TACN0279'

function createTeeYardages(row: (typeof HOLE_TABLE)[number]): TeeYardages {
  return { gold: row[1], blue: row[2], white: row[3], red: row[4] }
}

/**
 * 净山湖 V0.5 的运行时数据。洞号、Par 和四档距离沿用 V0；
 * OSM 已提供球场范围和未编号绿地，但没有逐洞编号，故洞级空间字段继续保持 null。
 */
export const jingshanhuV05Course: GolfCourseGeoJSON = {
  type: 'FeatureCollection',
  properties: {
    id: 'jingshanhu-v0.5',
    name: '北京净山湖高尔夫俱乐部（V0.5）',
    source: 'Tiger Booking hole table; Bestdo course summary; Bing Maps place card; OpenStreetMap Overpass spatial reference',
    coordinateSystem: 'WGS84',
    verified: false,
    demo: false,
    dataStatus: 'unverified',
    provenance: [
      sourceUrl,
      'https://weixin.bestdo.com/wx/item/info?mer_item_id=10200931000018',
      'https://cn.bing.com/search?q=%E5%87%80%E5%B1%B1%E6%B9%96%E9%AB%98%E5%B0%94%E5%A4%AB',
      'https://overpass-api.de/api/interpreter',
    ],
  },
  features: HOLE_TABLE.map((row, index) => ({
    type: 'Feature' as const,
    geometry: null,
    properties: {
      hole: index + 1,
      par: row[0],
      teeYardages: createTeeYardages(row),
      teeCenter: null,
      greenCenter: null,
      centerline: null,
      spatialConfidence: 'none' as const,
      spatialVerified: false,
      spatialDigitization: 'none' as const,
      spatialEstimated: false,
      source,
      provenance: {
        hole: [sourceUrl],
        par: [sourceUrl],
        teeYardages: [sourceUrl],
        teeCenter: ['data/metadata/jingshanhu_v0_5.md'],
        greenCenter: ['data/metadata/jingshanhu_v0_5.md'],
        centerline: ['data/metadata/jingshanhu_v0_5.md'],
      },
      holeNumberVerified: true,
      parStatus: 'unverified' as const,
      teeCenterStatus: 'unknown' as const,
      polygonStatus: 'unknown' as const,
      greenCenterStatus: 'unknown' as const,
      centerlineStatus: 'unknown' as const,
      verified: false,
    },
  })),
}

/** 兼容 Thread 02/03 已有调用方；V0.5 仍保留同一导出名。 */
export const jingshanhuV0Course = jingshanhuV05Course
