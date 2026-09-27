import type { LocationState } from '../location/types'
import type { StorageLike } from './persistence'

export interface ReadinessCheck {
  key: string
  label: string
  ok: boolean
  detail: string
}

export function checkFieldReadiness(options: {
  locationState?: LocationState
  storage?: StorageLike | null
  candidateDatasetLoaded?: boolean
  exportSupported?: boolean
} = {}): ReadinessCheck[] {
  const locationState = options.locationState
  const geolocationSupported = typeof navigator !== 'undefined' && 'geolocation' in navigator
  const secure = typeof window === 'undefined' ? false : window.isSecureContext || window.location.protocol === 'https:' || window.location.hostname === 'localhost'
  const storage = options.storage ?? (typeof window !== 'undefined' ? window.localStorage : null)
  return [
    { key: 'geolocation', label: '浏览器支持 Geolocation', ok: geolocationSupported, detail: geolocationSupported ? '已支持' : '当前浏览器不支持定位' },
    { key: 'secure-context', label: '安全上下文', ok: secure, detail: secure ? 'HTTPS 或 localhost' : '真实设备需要 HTTPS' },
    { key: 'gps', label: 'GPS 已返回', ok: locationState?.status === 'success' && locationState.location !== null, detail: locationState?.status === 'success' ? '已收到位置' : '等待定位返回' },
    { key: 'storage', label: '本地存储可用', ok: storage !== null, detail: storage !== null ? '可保存 Session' : '无法使用 localStorage' },
    { key: 'export', label: 'JSON 导出可用', ok: options.exportSupported ?? (typeof Blob !== 'undefined'), detail: (options.exportSupported ?? (typeof Blob !== 'undefined')) ? '浏览器支持文件导出' : '当前环境不支持 Blob' },
    { key: 'candidate', label: '候选数据已加载', ok: options.candidateDatasetLoaded ?? true, detail: (options.candidateDatasetLoaded ?? true) ? 'schema 2 candidate 已接入' : '候选数据不可用' },
  ]
}
