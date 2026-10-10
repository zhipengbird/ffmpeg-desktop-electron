import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { DEFAULT_SETTINGS, type EncoderInfo, type Settings } from '../../shared/types'

interface Ctx {
  settings: Settings
  loaded: boolean
  update: (patch: Partial<Settings>) => Promise<void>
  reset: () => Promise<void>
  exportSettings: () => Promise<{ success: boolean; path?: string; error?: string }>
  importSettings: () => Promise<{ success: boolean; settings?: Settings; error?: string }>
  hw: EncoderInfo
  redetect: () => Promise<void>
  platform: string
}

const SettingsContext = createContext<Ctx | null>(null)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [loaded, setLoaded] = useState(false)
  const [hw, setHw] = useState<EncoderInfo>({ ready: false, platform: window.api.platform, listed: [], tested: [], preferred: null })

  useEffect(() => {
    window.api.settings.get().then((s) => { setSettings(s); setLoaded(true) })
    window.api.hw.get().then(setHw)
    const off1 = window.api.settings.onChanged(setSettings)
    const off2 = window.api.hw.onInfo(setHw)
    return () => { off1(); off2() }
  }, [])

  const update = useCallback(async (patch: Partial<Settings>) => {
    setSettings((s) => ({ ...s, ...patch }))
    setSettings(await window.api.settings.set(patch))
  }, [])
  const reset = useCallback(async () => { setSettings(await window.api.settings.reset()) }, [])
  const exportSettings = useCallback(async () => await window.api.settings.export(), [])
  const importSettings = useCallback(async () => {
    const res = await window.api.settings.import()
    if (res.success && res.settings) {
      setSettings(res.settings)
    }
    return res
  }, [])
  const redetect = useCallback(async () => { setHw(await window.api.hw.redetect()) }, [])

  return (
    <SettingsContext.Provider value={{ settings, loaded, update, reset, exportSettings, importSettings, hw, redetect, platform: window.api.platform }}>
      {children}
    </SettingsContext.Provider>
  )
}

export function useSettings(): Ctx {
  const c = useContext(SettingsContext)
  if (!c) throw new Error('useSettings 必须在 SettingsProvider 内使用')
  return c
}
