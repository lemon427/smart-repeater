import { Capacitor } from '@capacitor/core'
import { CapacitorUpdater } from '@capgo/capacitor-updater'
import { APP_VERSION, UPDATE_BASE } from '@/config'

export interface UpdateInfo {
  state: 'checking' | 'downloading' | 'updated' | 'none' | 'error'
  progress: number
  message?: string
}

let listenerSetup = false

/**
 * 应用内热更新（仅原生 Android 生效，网页版自动跳过）：
 * 1. 启动时上报当前版本就绪（失败自动回滚）
 * 2. 检查 UPDATE_BASE/latest.json，发现新版本则后台下载并切换
 */
export async function setupAutoUpdate(onChange: (info: UpdateInfo) => void): Promise<void> {
  if (Capacitor.getPlatform() !== 'android') return
  if (UPDATE_BASE.includes('example.github.io')) {
    onChange({ state: 'none', progress: 0, message: '热更新地址未配置' })
    return
  }
  try {
    await CapacitorUpdater.notifyAppReady()
  } catch {
    /* 忽略 */
  }
  if (!listenerSetup) {
    listenerSetup = true
    CapacitorUpdater.addListener('download', (p) => {
      onChange({ state: 'downloading', progress: p.percent ?? 0 })
    }).catch(() => {})
  }
  onChange({ state: 'checking', progress: 0 })
  try {
    const res = await fetch(`${UPDATE_BASE}latest.json?ts=${Date.now()}`, { cache: 'no-store' })
    if (!res.ok) {
      onChange({ state: 'none', progress: 0 })
      return
    }
    const latest = (await res.json()) as { version?: string; url?: string }
    if (!latest.version || !latest.url || latest.version === APP_VERSION) {
      onChange({ state: 'none', progress: 0 })
      return
    }
    onChange({ state: 'downloading', progress: 0, message: `发现新版本 ${latest.version}，正在后台下载…` })
    const bundle = await CapacitorUpdater.download({ url: latest.url, version: latest.version })
    await CapacitorUpdater.set({ id: bundle.id })
    onChange({ state: 'updated', progress: 100, message: `已更新到 ${latest.version}，重启应用后生效` })
  } catch {
    onChange({ state: 'error', progress: 0, message: '检查更新失败，下次启动再试' })
  }
}
