import fs from 'fs'
import path from 'path'
import { DEFAULT_SETTINGS, type Settings } from '../../shared/types'

function clampInt(v: unknown, min: number, max: number, def: number): number {
  const n = typeof v === 'number' ? v : parseInt(String(v), 10)
  if (!Number.isFinite(n)) return def
  return Math.min(max, Math.max(min, Math.round(n)))
}

/** 合并并校验设置，未知字段丢弃。 */
export function sanitizeSettings(raw: unknown, base: Settings = DEFAULT_SETTINGS): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof Settings, unknown>>
  const pick = <K extends keyof Settings>(k: K): unknown => (r[k] !== undefined ? r[k] : base[k])
  const bool = (k: keyof Settings) => (typeof pick(k) === 'boolean' ? (pick(k) as boolean) : (base[k] as boolean))
  const outputMode = pick('outputMode') === 'custom' ? 'custom' : 'source'
  const cp = pick('conflictPolicy')
  return {
    outputMode,
    outputDir: typeof pick('outputDir') === 'string' ? (pick('outputDir') as string) : '',
    conflictPolicy: cp === 'overwrite' || cp === 'skip' ? cp : 'rename',
    keepSuffix: bool('keepSuffix'),
    notifyOnFinish: bool('notifyOnFinish'),
    openFolderOnFinish: bool('openFolderOnFinish'),
    concurrency: clampInt(pick('concurrency'), 1, 8, base.concurrency),
    imageConcurrency: clampInt(pick('imageConcurrency'), 1, 16, base.imageConcurrency),
    hwAccel: bool('hwAccel'),
    hwEncoder: typeof pick('hwEncoder') === 'string' && pick('hwEncoder') ? (pick('hwEncoder') as string) : 'auto',
    stripMetadata: bool('stripMetadata'),
    quietMode: bool('quietMode')
  }
}

export class SettingsStore {
  private value: Settings
  constructor(private readonly file: string) {
    this.value = this.load()
  }

  private load(): Settings {
    try {
      return sanitizeSettings(JSON.parse(fs.readFileSync(this.file, 'utf8')))
    } catch {
      return { ...DEFAULT_SETTINGS }
    }
  }

  get(): Settings {
    return { ...this.value }
  }

  update(patch: Partial<Settings>): Settings {
    this.value = sanitizeSettings({ ...this.value, ...patch }, this.value)
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      const tmp = `${this.file}.tmp`
      fs.writeFileSync(tmp, JSON.stringify(this.value, null, 2), 'utf8')
      fs.renameSync(tmp, this.file)
    } catch (e) {
      console.error('[settings] 保存失败', e)
    }
    return this.get()
  }

  replace(newSettings: Settings): Settings {
    this.value = sanitizeSettings(newSettings, DEFAULT_SETTINGS)
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      const tmp = `${this.file}.tmp`
      fs.writeFileSync(tmp, JSON.stringify(this.value, null, 2), 'utf8')
      fs.renameSync(tmp, this.file)
    } catch (e) {
      console.error('[settings] 保存失败', e)
    }
    return this.get()
  }

  reset(): Settings {
    return this.update({ ...DEFAULT_SETTINGS })
  }
}
