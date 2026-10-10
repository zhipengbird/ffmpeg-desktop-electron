import path from 'path'
import fs from 'fs'
import { app } from 'electron'
import { setBinaryPaths, getFfmpegPath, getFfprobePath } from './core/binaries'

let ffmpegPath: string
let ffprobePath: string

/**
 * 打包环境下的 ffmpeg / ffprobe 路径解析（保持原有逻辑不变），
 * 解析结果注册到 core/binaries，供 core/* 纯模块使用。
 */

/** Binaries cannot run from inside asar; rewrite to unpacked path. */
function unpackAsarPath(p: string): string {
  if (p && p.includes('app.asar') && !p.includes('app.asar.unpacked')) {
    return p.replace('app.asar', 'app.asar.unpacked')
  }
  return p
}

function resolveBinary(pkgName: string, fallbackNames: string[]): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(pkgName)
    let p = typeof mod === 'string' ? mod : mod.path
    if (p) {
      p = unpackAsarPath(p)
      if (fs.existsSync(p)) return p
    }
  } catch {
    /* continue */
  }
  const candidates = [
    path.join(process.resourcesPath || '', 'app.asar.unpacked', 'node_modules', pkgName),
    path.join(app.getAppPath().replace('app.asar', 'app.asar.unpacked'), 'node_modules', pkgName),
    path.join(__dirname, '..', 'node_modules', pkgName)
  ]
  for (const base of candidates) {
    for (const name of fallbackNames) {
      const full = path.join(base, name)
      if (fs.existsSync(full)) return full
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require(path.join(base, 'index.js'))
      let p = typeof mod === 'string' ? mod : mod?.path
      if (p) {
        p = unpackAsarPath(p)
        if (fs.existsSync(p)) return p
      }
    } catch {
      /* continue */
    }
  }
  return fallbackNames[0].includes('ffprobe') ? 'ffprobe' : 'ffmpeg'
}

export function initFfmpegPaths(): void {
  const isWin = process.platform === 'win32'
  ffmpegPath = resolveBinary('ffmpeg-static', [isWin ? 'ffmpeg.exe' : 'ffmpeg'])

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ffprobeStatic = require('ffprobe-static')
    let p = ffprobeStatic.path as string
    p = unpackAsarPath(p)
    if (fs.existsSync(p)) {
      ffprobePath = p
    } else {
      ffprobePath = resolveBinary('ffprobe-static', [
        path.join(process.platform, process.arch, isWin ? 'ffprobe.exe' : 'ffprobe')
      ])
    }
  } catch {
    ffprobePath = resolveBinary('ffprobe-static', [
      path.join(process.platform, process.arch, isWin ? 'ffprobe.exe' : 'ffprobe')
    ])
  }

  // Ensure executable bit on unix
  for (const bin of [ffmpegPath, ffprobePath]) {
    try {
      if (bin && fs.existsSync(bin) && process.platform !== 'win32') {
        fs.chmodSync(bin, 0o755)
      }
    } catch { /* ignore */ }
  }

  setBinaryPaths(ffmpegPath, ffprobePath)

  console.log('[ffmpeg] path:', ffmpegPath, 'exists=', fs.existsSync(ffmpegPath))
  console.log('[ffprobe] path:', ffprobePath, 'exists=', fs.existsSync(ffprobePath))
}

export { getFfmpegPath, getFfprobePath }
export * from './core/runner'
export * from './core/probe'
export * from './core/media'
