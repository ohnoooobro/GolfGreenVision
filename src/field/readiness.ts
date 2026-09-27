import type { LocationState } from '../location/types'
import type { StorageLike } from './persistence'

export interface ReadinessCheck {
  key: string
  label: string
  ok: boolean
  detail: string
}

export type GeolocationPermissionState = PermissionState | 'unknown' | 'unsupported'

export function checkFieldReadiness(options: {
  locationState?: LocationState
  storage?: StorageLike | null
  candidateDatasetLoaded?: boolean
  exportSupported?: boolean
  geolocationPermission?: GeolocationPermissionState
} = {}): ReadinessCheck[] {
  const locationState = options.locationState
  const geolocationSupported = typeof navigator !== 'undefined' && 'geolocation' in navigator
  const secure = typeof window !== 'undefined' && (typeof window.isSecureContext === 'boolean' ? window.isSecureContext : window.location.protocol === 'https:' || window.location.hostname === 'localhost')
  const storage = options.storage ?? (() => {
    if (typeof window === 'undefined') return null
    try { return window.localStorage ?? null } catch { return null }
  })()
  const permission = options.geolocationPermission ?? 'unknown'
  const storageAvailable = storage !== null && (() => {
    try {
      const key = 'golf-green-vision.readiness-probe'
      storage.setItem(key, '1')
      storage.removeItem(key)
      return true
    } catch { return false }
  })()
  const exportSupported = options.exportSupported ?? (typeof Blob !== 'undefined' && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function')
  return [
    { key: 'geolocation', label: '浏览器支持 Geolocation', ok: geolocationSupported, detail: geolocationSupported ? '已支持' : '当前浏览器不支持定位' },
    { key: 'secure-context', label: 'HTTPS / 安全上下文', ok: secure, detail: secure ? '安全连接可用' : '当前页面不是安全连接，手机定位可能不可用。' },
    { key: 'permission', label: '定位权限', ok: permission !== 'denied', detail: permission === 'granted' ? '已允许' : permission === 'prompt' ? '等待浏览器询问并允许' : permission === 'denied' ? '已拒绝，请在浏览器设置中恢复' : permission === 'unsupported' ? '浏览器未提供权限状态查询，点击定位时确认' : '尚未查询' },
    { key: 'gps', label: 'GPS 已返回', ok: locationState?.status === 'success' && locationState.location !== null, detail: locationState?.status === 'success' ? '已收到位置' : '等待定位返回' },
    { key: 'storage', label: '本地存储可用', ok: storageAvailable, detail: storageAvailable ? '可保存 Session' : '无法使用 localStorage' },
    { key: 'export', label: 'JSON 导出可用', ok: exportSupported, detail: exportSupported ? '浏览器支持文件导出' : '当前环境不支持 Blob 或对象 URL' },
    { key: 'candidate', label: '候选数据已加载', ok: options.candidateDatasetLoaded ?? true, detail: (options.candidateDatasetLoaded ?? true) ? 'schema 2 candidate 已接入' : '候选数据不可用' },
  ]
}
