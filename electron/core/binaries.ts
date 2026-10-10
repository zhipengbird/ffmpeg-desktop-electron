/** 二进制路径注册表：由 electron/ffmpeg.ts（打包解析逻辑）或测试脚本设置。 */
let ffmpegPath = 'ffmpeg'
let ffprobePath = 'ffprobe'

export function setBinaryPaths(ffmpeg: string, ffprobe: string): void {
  ffmpegPath = ffmpeg
  ffprobePath = ffprobe
}

export function getFfmpegPath(): string {
  return ffmpegPath
}

export function getFfprobePath(): string {
  return ffprobePath
}
