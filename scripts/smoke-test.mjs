import path from 'path'
import fs from 'fs'
import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const samples = path.join(root, 'samples')
const outDir = path.join(samples, 'out')
fs.mkdirSync(outDir, { recursive: true })

const ffmpeg = require('ffmpeg-static')
const ffprobe = require('ffprobe-static').path
const sharp = (await import('sharp')).default

console.log('ffmpeg:', ffmpeg)
console.log('ffprobe:', ffprobe)

function run(bin, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args)
    let err = ''
    p.stderr.on('data', d => { err += d })
    p.on('close', code => code === 0 ? resolve() : reject(new Error(err.slice(-500))))
  })
}

async function probe(file) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffprobe, ['-v','quiet','-print_format','json','-show_format','-show_streams', file])
    let out = ''
    p.stdout.on('data', d => out += d)
    p.on('close', code => code === 0 ? resolve(JSON.parse(out)) : reject(new Error('probe fail')))
  })
}

const video = path.join(samples, 'sample.mp4')
const audio = path.join(samples, 'sample.mp3')
const image = path.join(samples, 'sample.jpg')

console.log('\n1) probe video')
const info = await probe(video)
console.log('  duration=', info.format.duration, 'streams=', info.streams.length)

console.log('\n2) compress video')
const vOut = path.join(outDir, 'compressed.mp4')
await run(ffmpeg, ['-y','-i',video,'-c:v','libx264','-crf','28','-preset','fast','-c:a','aac','-b:a','96k',vOut])
console.log('  ok', fs.statSync(vOut).size, 'bytes')

console.log('\n3) extract audio')
const aOut = path.join(outDir, 'extracted.mp3')
await run(ffmpeg, ['-y','-i',video,'-vn','-c:a','libmp3lame','-b:a','192k',aOut])
console.log('  ok', fs.statSync(aOut).size, 'bytes')

console.log('\n4) extract video-only')
const voOut = path.join(outDir, 'silent.mp4')
await run(ffmpeg, ['-y','-i',video,'-an','-c:v','copy',voOut])
console.log('  ok', fs.statSync(voOut).size, 'bytes')

console.log('\n5) convert to webm (short)')
const wOut = path.join(outDir, 'converted.webm')
await run(ffmpeg, ['-y','-i',video,'-c:v','libvpx-vp9','-b:v','500k','-c:a','libopus','-t','1',wOut])
console.log('  ok', fs.statSync(wOut).size, 'bytes')

console.log('\n6) trim')
const tOut = path.join(outDir, 'trimmed.mp4')
await run(ffmpeg, ['-y','-ss','0','-i',video,'-t','1','-c','copy','-avoid_negative_ts','make_zero',tOut])
console.log('  ok', fs.statSync(tOut).size, 'bytes')

console.log('\n7) compress audio')
const acOut = path.join(outDir, 'audio_small.mp3')
await run(ffmpeg, ['-y','-i',audio,'-c:a','libmp3lame','-b:a','64k',acOut])
console.log('  ok', fs.statSync(acOut).size, 'bytes (orig', fs.statSync(audio).size, ')')

console.log('\n8) image compress sharp')
const iOut = path.join(outDir, 'compressed.jpg')
await sharp(image).jpeg({ quality: 50, mozjpeg: true }).toFile(iOut)
console.log('  ok', fs.statSync(iOut).size, 'bytes (orig', fs.statSync(image).size, ')')

console.log('\nALL SMOKE TESTS PASSED')
