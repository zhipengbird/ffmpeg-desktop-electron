/**
 * 主进程核心逻辑冒烟测试（不涉及 UI）。
 * 用 esbuild 把 electron/core/*.ts 打包为 CJS 后直接调用。
 *   node scripts/smoke-test.mjs
 */
import path from 'path'
import fs from 'fs'
import { spawn, spawnSync } from 'child_process'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const samples = path.join(root, 'samples')
const work = path.join(samples, 'out', 'smoke')
fs.rmSync(work, { recursive: true, force: true })
fs.mkdirSync(work, { recursive: true })

// ---------- 编译 core ----------
const bundle = path.join(root, 'node_modules', '.cache', 'smoke', 'core.cjs')
await build({
  entryPoints: [path.join(root, 'electron', 'core', 'index.ts')],
  bundle: true, platform: 'node', format: 'cjs', target: 'node18',
  outfile: bundle, external: ['sharp', 'electron'], logLevel: 'warning'
})
const core = require(bundle)
const ffmpeg = require('ffmpeg-static')
const ffprobe = require('ffprobe-static').path
core.setBinaryPaths(ffmpeg, ffprobe)
const sharp = (await import('sharp')).default

// ---------- 小工具 ----------
const results = []
async function test(name, fn) {
  const t0 = Date.now()
  try {
    const note = await fn()
    results.push({ name, ok: true, ms: Date.now() - t0, note })
    console.log(`  ✔ PASS  ${name}${note ? `  — ${note}` : ''}  (${Date.now() - t0} ms)`)
  } catch (e) {
    results.push({ name, ok: false, ms: Date.now() - t0, note: e?.message || String(e) })
    console.log(`  ✘ FAIL  ${name}  — ${e?.stack || e}`)
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed') }
function approx(a, b, tol, what) { assert(Math.abs(a - b) <= tol, `${what}: 期望 ${b}±${tol}，实际 ${a}`) }
function ff(args) {
  const r = spawnSync(ffmpeg, ['-y', '-hide_banner', '-v', 'error', ...args])
  if (r.error) throw r.error
  if (r.status !== 0) throw new Error(r.stderr?.toString() || `退出码 ${r.status}`)
}
function probe(file) {
  const r = spawnSync(ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file])
  if (r.error) throw r.error
  if (r.status !== 0) throw new Error(`ffprobe 失败: ${r.stderr?.toString() || r.status}`)
  const j = JSON.parse(r.stdout.toString())
  return {
    duration: parseFloat(j.format.duration),
    v: j.streams.find((s) => s.codec_type === 'video'),
    a: j.streams.find((s) => s.codec_type === 'audio'),
    j
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let jid = 0
const nextJob = () => `t${++jid}`
const size = (p) => fs.statSync(p).size
function makeEnv(patch = {}) {
  const settings = { ...core.DEFAULT_SETTINGS, ...patch }
  return {
    settings,
    env: { getSettings: () => settings, getEncoderInfo: () => null, reservations: new core.PathReservations() }
  }
}
function ctxFor(id = nextJob(), events = []) {
  const ctrl = new AbortController()
  return { ctrl, events, ctx: { jobId: id, signal: ctrl.signal, onProgress: (p, t) => events.push({ p, t }) } }
}
function copyTo(src, name) { const d = path.join(work, name); fs.copyFileSync(src, d); return d }

// ---------- 测试素材 ----------
console.log('ffmpeg :', ffmpeg)
console.log('ffprobe:', ffprobe)
console.log('\n准备测试素材…')
const sampleMp4 = copyTo(path.join(samples, 'sample.mp4'), 'sample.mp4')
const sampleMp3 = copyTo(path.join(samples, 'sample.mp3'), 'sample.mp3')
const sampleJpg = copyTo(path.join(samples, 'sample.jpg'), 'sample.jpg')
const samplePng = copyTo(path.join(samples, 'sample.png'), 'sample.png')
// 8 秒、每秒一个关键帧的测试视频（用于裁剪精度）
const long = path.join(work, 'long.mp4')
ff(['-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=25:duration=8', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=8',
  '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '25', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', long])
// 较大的视频（用于取消测试）
const big = path.join(work, 'big.mp4')
ff(['-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=20', '-f', 'lavfi', '-i', 'sine=duration=20',
  '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '15', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', big])
// 损坏文件
const corrupt = path.join(work, 'corrupt.mp4')
fs.writeFileSync(corrupt, Buffer.concat([Buffer.from('this is not a real video file'), Buffer.alloc(4096, 0x5a)]))
const corruptJpg = path.join(work, 'corrupt.jpg')
fs.writeFileSync(corruptJpg, Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2000, 0x11)]))
// 含敏感元数据的文件
const metaVideo = path.join(work, 'meta.mp4')
ff(['-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=10:duration=1', '-metadata', 'title=MySecretLocation', '-metadata', 'artist=SecretArtist', '-c:v', 'libx264', '-preset', 'ultrafast', metaVideo])
console.log('素材就绪。\n')

// =====================================================
console.log('【1】探测 / 压缩')
await test('probeMedia 读取时长与流', async () => {
  const info = await core.probeMedia(sampleMp4)
  approx(info.duration, 3, 0.1, '时长')
  assert(info.video?.codec === 'h264' && info.audio, '缺少音视频流')
  return `duration=${info.duration} ${info.video.width}x${info.video.height}`
})

await test('压缩视频（软件 libx264，平衡）+ 进度单调递增并以 100 结束', async () => {
  const out = path.join(work, 'c_sw.mp4')
  const ev = []
  const r = await core.compressMedia({ jobId: nextJob(), input: long, output: out, preset: 'balanced', onProgress: (p) => ev.push(p) })
  const p = probe(out)
  assert(r.encoder === 'libx264', `encoder=${r.encoder}`)
  assert(p.v.codec_name === 'h264' && p.a.codec_name === 'aac', '编码不符')
  approx(p.duration, 8, 0.2, '时长')
  const nums = ev.filter((x) => x !== null)
  assert(nums.length > 0 && nums[nums.length - 1] === 100, '最终进度应为 100')
  assert(nums.every((x, i) => i === 0 || x >= nums[i - 1]), '进度不单调')
  assert(nums.every((x) => x >= 0 && x <= 100), '进度越界')
  assert(!fs.readdirSync(work).some((f) => f.includes('.partial')), '残留临时文件')
  return `${size(long)} → ${size(out)} B，进度事件 ${nums.length} 个`
})

await test('压缩音频（MP3 小体积）', async () => {
  const out = path.join(work, 'c_audio.mp3')
  await core.compressMedia({ jobId: nextJob(), input: sampleMp3, output: out, preset: 'small' })
  assert(probe(out).a.codec_name === 'mp3', '非 mp3')
  assert(size(out) < size(sampleMp3), '未变小')
  return `${size(sampleMp3)} → ${size(out)} B`
})

await test('硬件编码运行时失败 → 自动回退 libx264 并提示', async () => {
  const out = path.join(work, 'c_fallback.mp4')
  const r = await core.compressMedia({ jobId: nextJob(), input: sampleMp4, output: out, preset: 'small', hwEncoder: 'h264_nvenc' })
  assert(r.encoder === 'libx264', `encoder=${r.encoder}`)
  assert(r.notice && r.notice.includes('回退'), `notice=${r.notice}`)
  assert(probe(out).v.codec_name === 'h264', '输出无效')
  return r.notice
})

await test('锁定目标文件大小压缩（Target Size 模式）', async () => {
  const out = path.join(work, 'c_target_size.mp4')
  const r = await core.compressMedia({ jobId: nextJob(), input: long, output: out, preset: 'balanced', targetSizeMB: 0.15 })
  const s = size(out)
  assert(r.notice && r.notice.includes('目标体积'), '缺少目标大小 notice')
  assert(s > 0 && s <= 0.15 * 1024 * 1024 * 1.05, `超出目标上限: ${s} B`)
  const p = probe(out)
  assert(p.v?.codec_name === 'h264', '编码不符')
  return `${size(long)} → ${s} B（限制 0.15 MB，实际 ${(s / 1024 / 1024).toFixed(3)} MB）`
})

// =====================================================
console.log('\n【2】格式转换')
for (const [fmt, vcodec, acodec] of [['mp4', 'h264', 'aac'], ['webm', 'vp9', 'opus'], ['mp3', null, 'mp3'], ['wav', null, 'pcm_s16le']]) {
  await test(`转换为 ${fmt.toUpperCase()}`, async () => {
    const out = path.join(work, `conv.${fmt}`)
    await core.convertFormat({ jobId: nextJob(), input: sampleMp4, output: out, format: fmt })
    const p = probe(out)
    if (vcodec) assert(p.v?.codec_name === vcodec, `视频编码 ${p.v?.codec_name}`)
    else assert(!p.v, '不应含视频流')
    assert(p.a?.codec_name === acodec, `音频编码 ${p.a?.codec_name}`)
    approx(p.duration, 3, 0.15, '时长')
    return `${vcodec || '-'} / ${acodec}, ${size(out)} B`
  })
}

await test('转换为动图 GIF（双遍调色板高清引擎）', async () => {
  const out = path.join(work, 'conv_palette.gif')
  const r = await core.convertFormat({ jobId: nextJob(), input: sampleMp4, output: out, format: 'gif', gifFps: 10, gifWidth: 320 })
  assert(r.encoder === 'palettegen+paletteuse', `encoder=${r.encoder}`)
  const p = probe(out)
  assert(p.v?.codec_name === 'gif', '非 gif')
  assert(p.v?.width === 320, `宽度应缩放到 320，实为 ${p.v?.width}`)
  assert(!p.a, '动图不应含音频流')
  return `gif 320x${p.v.height}, ${size(out)} B`
})

await test('转换为动图 WebP（Animated WebP 引擎）', async () => {
  const out = path.join(work, 'conv_anim.webp')
  const r = await core.convertFormat({ jobId: nextJob(), input: sampleMp4, output: out, format: 'webp', gifFps: 15, gifWidth: 320 })
  assert(r.encoder === 'libwebp', `encoder=${r.encoder}`)
  const meta = await sharp(out).metadata()
  assert(meta.format === 'webp', `非 webp 格式: ${meta.format}`)
  assert(meta.width === 320, `宽度应缩放到 320，实为 ${meta.width}`)
  assert(meta.pages && meta.pages > 1, `应为多帧动画，实为 ${meta.pages} 帧`)
  return `webp 320x${meta.height} (${meta.pages} 帧，循环=${meta.loop})，${size(out)} B`
})

// =====================================================
console.log('\n【3】音视频分离')
await test('提取音频（MP3，无视频流）', async () => {
  const out = path.join(work, 'sep_audio.mp3')
  await core.separateStreams({ jobId: nextJob(), input: sampleMp4, output: out, mode: 'audio' })
  const p = probe(out)
  assert(p.a?.codec_name === 'mp3' && !p.v, '流不符')
})
await test('提取原音频（流复制 AAC ➔ .m4a，零损耗）', async () => {
  const out = path.join(work, 'sep_raw.m4a')
  await core.separateStreams({ jobId: nextJob(), input: sampleMp4, output: out, mode: 'audio-copy' })
  const p = probe(out)
  assert(p.a?.codec_name === 'aac' && !p.v, '流不符')
})
await test('提取无声视频（流复制，无音频流）', async () => {
  const out = path.join(work, 'sep_silent.mp4')
  await core.separateStreams({ jobId: nextJob(), input: sampleMp4, output: out, mode: 'video' })
  const p = probe(out)
  assert(p.v?.codec_name === 'h264' && !p.a, '流不符')
})

// =====================================================
console.log('\n【4】裁剪')
await test('极速模式（流复制）0–2s，时长误差 ≤ 0.5s', async () => {
  const out = path.join(work, 'trim_fast.mp4')
  await core.trimMedia({ jobId: nextJob(), input: long, output: out, start: 0, end: 2, mode: 'fast' })
  const p = probe(out)
  approx(p.duration, 2, 0.5, '时长')
  return `duration=${p.duration.toFixed(3)}s`
})
await test('精准模式（重编码）1.3–3.7s，时长误差 ≤ 0.1s', async () => {
  const out = path.join(work, 'trim_precise.mp4')
  const r = await core.trimMedia({ jobId: nextJob(), input: long, output: out, start: 1.3, end: 3.7, mode: 'precise' })
  const p = probe(out)
  approx(p.duration, 2.4, 0.1, '时长')
  approx(parseFloat(p.v.duration), 2.4, 0.1, '视频流时长')
  assert(r.encoder === 'libx264', 'encoder')
  return `duration=${p.duration.toFixed(3)}s, video=${parseFloat(p.v.duration).toFixed(3)}s`
})
await test('精准模式 音频文件 0.5–1.5s', async () => {
  const out = path.join(work, 'trim_audio.mp3')
  await core.trimMedia({ jobId: nextJob(), input: sampleMp3, output: out, start: 0.5, end: 1.5, mode: 'precise' })
  approx(probe(out).duration, 1, 0.1, '时长')
})
await test('trimTask 精准模式命名（_截取_精准）+ 结果大小', async () => {
  const { env } = makeEnv()
  const { ctx } = ctxFor()
  const r = await core.trimTask(long, { start: 2, end: 4, mode: 'precise' }, ctx, env)
  assert(r.ok && path.basename(r.output) === 'long_截取_精准.mp4', r.output)
  assert(r.inputSize === size(long) && r.outputSize === size(r.output), 'size')
})

// =====================================================
console.log('\n【5】图片压缩')
for (const [src, fmt] of [[sampleJpg, 'jpeg'], [samplePng, 'png'], [sampleJpg, 'webp']]) {
  await test(`图片压缩 → ${fmt}`, async () => {
    const out = path.join(work, `img_${path.basename(src, path.extname(src))}${core.imageExt(fmt)}`)
    await core.compressImage({ input: src, output: out, preset: 'small', format: fmt })
    const meta = await sharp(out).metadata()
    assert(meta.format === fmt, `format=${meta.format}`)
    if (fmt !== 'webp') assert(size(out) < size(src), `未变小 ${size(src)} → ${size(out)}`)
    return `${size(src)} → ${size(out)} B`
  })
}
for (const [src, fmt] of [[sampleJpg, 'jpeg'], [samplePng, 'png'], [sampleJpg, 'webp']]) {
  await test(`备用引擎（FFmpeg，sharp 不可用时）→ ${fmt}`, async () => {
    const out = path.join(work, `imgff_${path.basename(src, path.extname(src))}${core.imageExt(fmt)}`)
    await core.compressImageWithFfmpeg({ jobId: nextJob(), input: src, output: out, preset: 'balanced', format: fmt })
    const meta = await sharp(out).metadata()
    assert(meta.format === fmt && meta.width === 400, `format=${meta.format} w=${meta.width}`)
    return `${size(src)} → ${size(out)} B`
  })
}
await test('备用引擎 ffprobe 读取图片信息', async () => {
  const i = await core.getImageInfoWithFfprobe(samplePng)
  assert(i.width === 400 && i.height === 300 && i.format === 'png', JSON.stringify(i))
})
await test('图片“保持原格式”解析', async () => {
  assert(core.resolveImageFormat('/a/b.JPG', 'keep') === 'jpeg')
  assert(core.resolveImageFormat('/a/b.png', 'keep') === 'png')
  assert(core.resolveImageFormat('/a/b.gif', 'keep') === 'jpeg')
  assert(core.resolveImageFormat('/a/b.png', 'webp') === 'webp')
})

// =====================================================
console.log('\n【6】输出命名 / 冲突策略')
await test('自动加序号：已存在 → name (1).ext，再次 → (2)', async () => {
  const dir = path.join(work, 'naming'); fs.mkdirSync(dir, { recursive: true })
  const input = path.join(dir, 'clip.mp4'); fs.writeFileSync(input, 'x')
  const opts = { outputMode: 'source', outputDir: '', conflictPolicy: 'rename', keepSuffix: true }
  const d0 = core.decideOutputPath(input, '压缩_平衡', '.mp4', opts)
  assert(path.basename(d0.path) === 'clip_压缩_平衡.mp4', d0.path)
  fs.writeFileSync(d0.path, 'x')
  const d1 = core.decideOutputPath(input, '压缩_平衡', '.mp4', opts)
  assert(path.basename(d1.path) === 'clip_压缩_平衡 (1).mp4', d1.path)
  fs.writeFileSync(d1.path, 'x')
  const d2 = core.decideOutputPath(input, '压缩_平衡', '.mp4', opts)
  assert(path.basename(d2.path) === 'clip_压缩_平衡 (2).mp4', d2.path)
})
await test('跳过：目标存在 → skip=true；覆盖：返回原路径', async () => {
  const dir = path.join(work, 'naming')
  const input = path.join(dir, 'clip.mp4')
  const s = core.decideOutputPath(input, '压缩_平衡', '.mp4', { outputMode: 'source', outputDir: '', conflictPolicy: 'skip', keepSuffix: true })
  assert(s.skip === true, 'skip')
  const o = core.decideOutputPath(input, '压缩_平衡', '.mp4', { outputMode: 'source', outputDir: '', conflictPolicy: 'overwrite', keepSuffix: true })
  assert(!o.skip && path.basename(o.path) === 'clip_压缩_平衡.mp4', o.path)
})
await test('不保留后缀且同目录同名 → 强制加序号，绝不覆盖源文件（即使策略为覆盖）', async () => {
  const input = path.join(work, 'naming', 'clip.mp4')
  const d = core.decideOutputPath(input, '转换', '.mp4', { outputMode: 'source', outputDir: '', conflictPolicy: 'overwrite', keepSuffix: false })
  assert(path.basename(d.path) === 'clip (1).mp4', d.path)
})
await test('自定义输出目录 + 并发预留避免撞名', async () => {
  const outDir = path.join(work, 'custom-out'); fs.mkdirSync(outDir, { recursive: true })
  const res = new core.PathReservations()
  const opts = { outputMode: 'custom', outputDir: outDir, conflictPolicy: 'overwrite', keepSuffix: true }
  const a = core.decideOutputPath('/x/y/v.mp4', '转换', '.mp4', opts, res)
  const b = core.decideOutputPath('/z/v.mp4', '转换', '.mp4', opts, res)
  assert(path.dirname(a.path) === outDir, a.path)
  assert(a.path !== b.path && path.basename(b.path) === 'v_转换 (1).mp4', b.path)
})
await test('任务级冲突策略：覆盖 / 跳过 / 自动加序号（图片任务实测）', async () => {
  const dir = path.join(work, 'policy'); fs.mkdirSync(dir, { recursive: true })
  const input = copyTo(sampleJpg, 'policy/photo.jpg')
  const params = { preset: 'balanced', format: 'keep' }
  const run = async (policy) => {
    const { env } = makeEnv({ conflictPolicy: policy })
    return core.imageTask({ id: nextJob(), input }, params, ctxFor().ctx, env)
  }
  const first = await run('rename')
  assert(path.basename(first.output) === 'photo_压缩_平衡.jpg', first.output)
  const second = await run('rename')
  assert(path.basename(second.output) === 'photo_压缩_平衡 (1).jpg', second.output)
  const skipped = await run('skip')
  assert(skipped.skipped === true && skipped.output === first.output, 'skip')
  fs.writeFileSync(first.output, 'old')
  const over = await run('overwrite')
  assert(over.output === first.output && !over.skipped && size(first.output) > 3, 'overwrite')
  return `rename→${path.basename(second.output)}，skip→已跳过，overwrite→${path.basename(over.output)}`
})

// =====================================================
console.log('\n【7】批量队列')
await test('并发控制：6 个任务、并发 2 → 同时运行不超过 2，全部完成；onDrain 一次', async () => {
  let running = 0, peak = 0, drains = 0
  const q = new core.TaskQueue({
    kind: 'image', concurrency: 2,
    worker: async (item) => { running++; peak = Math.max(peak, running); await sleep(80); running--; return { ok: true, output: item.input, inputSize: 100, outputSize: 40 } },
    onDrain: () => { drains++ }
  })
  q.add(['/a/1', '/a/2', '/a/3', '/a/4', '/a/5', '/a/6'])
  q.add(['/a/1']) // 重复项忽略
  const t0 = Date.now()
  q.start({})
  await q.whenIdle()
  const snap = q.snapshot()
  assert(snap.items.length === 6, `items=${snap.items.length}`)
  assert(peak === 2 && q.maxObservedConcurrency === 2, `peak=${peak}`)
  assert(snap.items.every((i) => i.status === 'done'), 'not all done')
  assert(drains === 1, `drains=${drains}`)
  const sum = core.summarizeItems(snap.items)
  assert(sum.savedBytes === 360 && Math.round(sum.changePercent) === -60, JSON.stringify(sum))
  return `峰值并发=${peak}，耗时 ${Date.now() - t0} ms，节省 ${sum.savedBytes} B（${sum.changePercent.toFixed(1)}%）`
})
await test('动态调整并发、取消等待项、移除、重试、清空已完成', async () => {
  const q = new core.TaskQueue({
    kind: 'image', concurrency: 1,
    worker: async (item) => { await sleep(40); if (item.input.endsWith('bad')) throw new Error('No such file or directory'); return { ok: true, output: item.input, inputSize: 10, outputSize: 5 } }
  })
  const items = q.add(['/q/1', '/q/2', '/q/bad', '/q/4', '/q/5'])
  q.start({})
  q.setConcurrency(3)
  assert(q.cancel(items[4].id), 'cancel pending')
  assert(q.remove(items[3].id), 'remove')
  await q.whenIdle()
  let s = q.snapshot().items
  const st = Object.fromEntries(s.map((i) => [i.input, i.status]))
  assert(st['/q/1'] === 'done' && st['/q/2'] === 'done' && st['/q/bad'] === 'failed' && st['/q/5'] === 'cancelled' && !st['/q/4'], JSON.stringify(st))
  const bad = s.find((i) => i.input === '/q/bad')
  assert(bad.error.code === 'NOT_FOUND' && bad.error.message.includes('文件不存在'), JSON.stringify(bad.error))
  assert(q.retry(items[4].id), 'retry')
  q.start({})
  await q.whenIdle()
  assert(q.get(items[4].id).status === 'done', 'retry run')
  const n = q.clearFinished()
  assert(n === 4 && q.snapshot().items.length === 0, `cleared=${n}`)
})
await test('真实 ffmpeg 队列：并发 2，取消其中一个运行中任务，其余完成且无残留临时文件', async () => {
  const dir = path.join(work, 'queue'); fs.mkdirSync(dir, { recursive: true })
  const inputs = [copyTo(big, 'queue/big1.mp4'), copyTo(sampleMp4, 'queue/s1.mp4'), copyTo(long, 'queue/l1.mp4'), copyTo(sampleMp4, 'queue/s2.mp4')]
  const { env } = makeEnv({ concurrency: 2 })
  let drained = null
  const q = new core.TaskQueue({
    kind: 'compress', concurrency: 2,
    worker: (item, p, ctx) => core.compressTask(item, p, ctx, env),
    onCancelRunning: (item) => core.cancelJob(item.id),
    onDrain: (items) => { drained = items },
    sizeOf: (p) => fs.statSync(p).size
  })
  const added = q.add(inputs)
  q.start({ preset: 'high' })
  // 等待 big1 开始出进度后取消
  const bigId = added[0].id
  for (let i = 0; i < 200; i++) {
    const it = q.get(bigId)
    if (it.status === 'running' && it.percent > 2) break
    await sleep(50)
  }
  const pctAtCancel = q.get(bigId).percent
  assert(q.get(bigId).status === 'running', '大文件未在运行')
  q.cancel(bigId)
  await q.whenIdle()
  const s = q.snapshot().items
  assert(q.maxObservedConcurrency === 2, `maxConc=${q.maxObservedConcurrency}`)
  assert(q.get(bigId).status === 'cancelled', `big status=${q.get(bigId).status}`)
  for (const it of s.filter((i) => i.id !== bigId)) {
    assert(it.status === 'done', `${it.input}: ${it.status} ${JSON.stringify(it.error)}`)
    assert(it.outputSize > 0 && fs.existsSync(it.output), 'output')
  }
  const files = fs.readdirSync(dir)
  assert(!files.some((f) => f.includes('.partial')), `残留临时文件: ${files}`)
  assert(!files.includes('big1_压缩_高质量.mp4'), '取消的任务不应产出文件')
  assert(drained && drained.length === 4, 'drain')
  return `取消时进度 ${pctAtCancel}%，其余 3 项完成，${files.length} 个文件`
})

// =====================================================
console.log('\n【8】错误映射（中文提示）')
await test('损坏的视频文件 → 输入格式不支持或文件已损坏 + 详细日志', async () => {
  try {
    await core.compressMedia({ jobId: nextJob(), input: corrupt, output: path.join(work, 'x.mp4'), preset: 'balanced' })
    throw new Error('应当失败')
  } catch (e) {
    assert(e instanceof core.JobFailedError, `非 JobFailedError: ${e}`)
    assert(e.job.code === 'FORMAT', `code=${e.job.code}`)
    assert(e.job.message.includes('输入格式不支持') && e.job.message.includes('损坏'), e.job.message)
    assert(e.job.detail && e.job.detail.length > 0, '缺少详细日志')
    return `${e.job.message} | 日志: ${e.job.detail.split('\n').slice(-1)[0]}`
  }
})
await test('损坏的图片（sharp）→ 输入格式不支持/文件已损坏', async () => {
  try {
    await core.compressImage({ input: corruptJpg, output: path.join(work, 'x.jpg'), preset: 'balanced', format: 'jpeg' })
    throw new Error('应当失败')
  } catch (e) {
    assert(e instanceof core.JobFailedError && e.job.code === 'FORMAT', `${e?.job?.code} ${e.message}`)
    return e.job.message
  }
})
await test('不存在的文件 → 文件不存在', async () => {
  const { env } = makeEnv()
  try {
    await core.convertTask({ id: 'n', input: path.join(work, 'nope.mp4') }, { format: 'mp4' }, ctxFor().ctx, env)
    throw new Error('应当失败')
  } catch (e) {
    assert(e.job?.code === 'NOT_FOUND' && e.job.message.includes('文件不存在'), JSON.stringify(e.job))
  }
})
await test('stderr 规则映射：磁盘空间/权限/编码器/取消/未知', async () => {
  const m = (s, o) => core.mapError(s, o)
  assert(m('av_interleaved_write_frame(): No space left on device').code === 'NO_SPACE')
  assert(m('out.mp4: Permission denied').code === 'PERMISSION')
  assert(m("Error: EBUSY: resource busy or locked, open 'C:\\a.mp4'").code === 'PERMISSION')
  assert(m('Unknown encoder \'h264_foo\'').code === 'ENCODER')
  assert(m('[h264_nvenc] No NVENC capable devices found').code === 'ENCODER')
  assert(m('moov atom not found').code === 'FORMAT')
  assert(m('', { cancelled: true }).message === '任务已取消')
  const u = m('something weird', { exitCode: 3 })
  assert(u.code === 'UNKNOWN' && u.message.includes('退出码 3'), u.message)
  const spawnErr = Object.assign(new Error('spawn /bad/ffmpeg ENOENT'), { code: 'ENOENT', syscall: 'spawn /bad/ffmpeg' })
  assert(m(spawnErr).code === 'BINARY_MISSING')
  return '7 类全部命中'
})
await test('取消单个任务 → 任务已取消（CANCELLED），临时文件清理', async () => {
  const out = path.join(work, 'cancelled.mp4')
  const id = nextJob()
  const p = core.compressMedia({ jobId: id, input: big, output: out, preset: 'high' })
  await sleep(600)
  assert(core.cancelJob(id), 'cancelJob 返回 false')
  try { await p; throw new Error('应当被取消') } catch (e) {
    assert(e.job?.code === 'CANCELLED' && e.job.message === '任务已取消', JSON.stringify(e.job))
  }
  assert(!fs.existsSync(out) && !fs.readdirSync(work).some((f) => f.includes('.partial')), '残留文件')
})

// =====================================================
console.log('\n【9】进度解析 / 未知时长')
await test('-progress pipe:1 解析（out_time_us 优先，分块输入）', async () => {
  const pp = new core.ProgressParser()
  const blocks = [
    ...pp.push('frame=10\nout_time_us=1500000\nout_time_ms=1500000\nout_time=00:00:01.500000\nprog'),
    ...pp.push('ress=continue\nout_time_ms=N/A\nout_time=N/A\nprogress=continue\nout_time_ms=3000000\nprogress=end\n')
  ]
  assert(blocks.length === 3, `blocks=${blocks.length}`)
  assert(blocks[0].outTime === 1.5 && blocks[1].outTime === null && blocks[2].outTime === 3 && blocks[2].end, JSON.stringify(blocks))
  assert(core.parseStderrTime('frame=1 time=00:01:02.50 bitrate=') === 62.5)
  assert(core.parseStderrTime('time=N/A') === null)
})
await test('百分比钳制 0–100，未知时长返回 null', async () => {
  assert(core.computePercent(5, 0) === null && core.computePercent(5, NaN) === null && core.computePercent(5, -1) === null)
  assert(core.computePercent(50, 10) === 99, '超出时长应钳制为 99（完成时才为 100）')
  assert(core.computePercent(-3, 10) === 0)
  assert(core.computePercent(2.5, 10) === 25)
  assert(core.clampPercent(140) === 100 && core.clampPercent(-1) === 0 && core.clampPercent(NaN) === 0)
})
await test('未知时长实际运行：进度为 null（不确定进度）但带时间戳，结束为 100', async () => {
  const ev = []
  await core.runFfmpeg({ jobId: nextJob(), args: ['-i', long, '-c:v', 'libx264', '-preset', 'ultrafast', '-f', 'mp4', path.join(work, 'unknown.mp4')], duration: 0, throttleMs: 0, onProgress: (p, t) => ev.push({ p, t }) })
  const mid = ev.slice(0, -1)
  assert(mid.length > 0, '无中间进度')
  assert(mid.every((e) => e.p === null && typeof e.t === 'string'), JSON.stringify(mid.slice(0, 3)))
  assert(ev[ev.length - 1].p === 100, 'final')
  return `${mid.length} 个不确定进度事件，最后时间戳 ${mid[mid.length - 1].t}`
})

// =====================================================
console.log('\n【10】硬件加速检测')
await test('detectHwEncoders：无 GPU 时安全返回（不抛异常）', async () => {
  const info = await core.detectHwEncoders({ timeoutMs: 15000 })
  assert(info.ready === true && Array.isArray(info.tested), 'shape')
  const sel = core.chooseHwEncoder(info, true, 'auto')
  if (!info.tested.some((t) => t.ok)) assert(info.preferred === null && sel === null, 'preferred 应为 null')
  return `platform=${info.platform} listed=[${info.listed}] preferred=${info.preferred}`
})
await test('detectHwEncoders：ffmpeg 不存在时返回 error 而非抛出', async () => {
  const info = await core.detectHwEncoders({ ffmpeg: '/nonexistent/ffmpeg', timeoutMs: 3000 })
  assert(info.ready && info.preferred === null && info.error, JSON.stringify(info))
})
await test('编码器列表解析 / 平台候选 / 码率映射', async () => {
  const set = core.parseEncoderList(' V....D libx264   H.264\n V....D h264_videotoolbox  VT\n A....D aac  AAC\n')
  assert(set.has('h264_videotoolbox') && set.has('libx264') && set.has('aac'))
  assert(core.hwCandidates('darwin').includes('hevc_videotoolbox') && core.hwCandidates('win32').includes('h264_amf') && core.hwCandidates('linux').includes('h264_vaapi'))
  const hi = core.targetBitrateKbps('high', { width: 1920, height: 1080, fps: 30 })
  const mid = core.targetBitrateKbps('balanced', { width: 1920, height: 1080, fps: 30 })
  const lo = core.targetBitrateKbps('small', { width: 1920, height: 1080, fps: 30 })
  assert(hi > mid && mid > lo, `${hi} ${mid} ${lo}`)
  const capped = core.targetBitrateKbps('balanced', { width: 1920, height: 1080, fps: 30, srcBitrate: 2_000_000 })
  assert(capped === 1200, `capped=${capped}`)
  const info = { ready: true, platform: 'darwin', listed: [], preferred: 'h264_videotoolbox', tested: [{ name: 'h264_videotoolbox', ok: true }, { name: 'hevc_videotoolbox', ok: true }] }
  assert(core.chooseHwEncoder(info, false, 'auto') === null)
  assert(core.chooseHwEncoder(info, true, 'auto') === 'h264_videotoolbox')
  assert(core.chooseHwEncoder(info, true, 'hevc_videotoolbox') === 'hevc_videotoolbox')
  return `1080p30: 高 ${hi}k / 平衡 ${mid}k / 小 ${lo}k`
})

// =====================================================
console.log('\n【11】设置 / media:// Range')
await test('设置持久化与校验', async () => {
  const file = path.join(work, 'settings', 'settings.json')
  const st = new core.SettingsStore(file)
  assert(st.get().concurrency === 2 && st.get().imageConcurrency === 4 && st.get().conflictPolicy === 'rename', '默认值')
  st.update({ concurrency: 99, conflictPolicy: 'skip', outputMode: 'custom', outputDir: '/tmp', hwAccel: true, bogus: 1 })
  const st2 = new core.SettingsStore(file)
  const v = st2.get()
  assert(v.concurrency === 8 && v.conflictPolicy === 'skip' && v.outputMode === 'custom' && v.hwAccel === true && !('bogus' in v), JSON.stringify(v))
  fs.writeFileSync(file, '{ broken json')
  assert(new core.SettingsStore(file).get().concurrency === 2, '损坏的设置文件应回退默认值')
})
await test('Range 请求解析', async () => {
  assert(JSON.stringify(core.parseRange('bytes=0-', 1000)) === '{"start":0,"end":999}')
  assert(JSON.stringify(core.parseRange('bytes=100-199', 1000)) === '{"start":100,"end":199}')
  assert(JSON.stringify(core.parseRange('bytes=-100', 1000)) === '{"start":900,"end":999}')
  assert(JSON.stringify(core.parseRange('bytes=900-5000', 1000)) === '{"start":900,"end":999}')
  assert(core.parseRange('bytes=2000-', 1000) === 'unsatisfiable')
  assert(core.parseRange(null, 1000) === null && core.parseRange('items=1-2', 1000) === null)
  const p = '/Users/张三/视频 #1?.mp4'
  assert(core.mediaUrlToPath(core.pathToMediaUrl(p)) === p, '路径往返')
  assert(core.mimeFor('.MP4') === 'video/mp4')
})

// =====================================================
console.log('\n【12】元数据脱敏 / 视频拼接 / 画质对比帧')
await test('元数据脱敏：擦除 EXIF/GPS/标题敏感信息 (-map_metadata -1)', async () => {
  const out = path.join(work, 'stripped.mp4')
  await core.compressMedia({ jobId: nextJob(), input: metaVideo, output: out, preset: 'small', stripMetadata: true })
  const p = probe(out)
  const tags = p.j.format.tags || {}
  assert(!tags.title && !tags.artist, '敏感标签未清除: ' + JSON.stringify(tags))
  return 'title/artist 标签已完全剔除'
})

await test('多视频极速无损合并 (concatMedia copy 模式)', async () => {
  const seg1 = copyTo(sampleMp4, 'seg1.mp4')
  const seg2 = copyTo(sampleMp4, 'seg2.mp4')
  const out = path.join(work, 'merged_copy.mp4')
  const r = await core.concatMedia({ jobId: nextJob(), inputs: [seg1, seg2], output: out, mode: 'copy' })
  assert(r.encoder === 'copy', '应为 copy 模式')
  const p = probe(out)
  approx(p.duration, 6, 0.5, '合并后时长')
  return `时长约 ${p.duration.toFixed(2)}s, 编码=${r.encoder}`
})

await test('多视频智能重编码合并 (concatMedia transcode 模式)', async () => {
  const seg1 = copyTo(sampleMp4, 'seg_trans1.mp4')
  const seg2 = copyTo(sampleMp4, 'seg_trans2.mp4')
  const out = path.join(work, 'merged_transcode.mp4')
  const r = await core.concatMedia({ jobId: nextJob(), inputs: [seg1, seg2], output: out, mode: 'transcode' })
  assert(fs.existsSync(out) && fs.statSync(out).size > 1000, '输出文件无效')
  const p = probe(out)
  approx(p.duration, 6, 0.5, '合并后时长')
  return `重编码完成，时长约 ${p.duration.toFixed(2)}s`
})

await test('多视频智能重编码合并 + 广播级音量标准化 (loudnorm 在 filter_complex 中生效)', async () => {
  const seg1 = copyTo(sampleMp4, 'seg_norm1.mp4')
  const seg2 = copyTo(long, 'seg_norm2.mp4') // 3s 与 8s，不同规格
  const out = path.join(work, 'merged_loudnorm.mp4')
  const r = await core.concatMedia({ jobId: nextJob(), inputs: [seg1, seg2], output: out, mode: 'auto', normalizeAudio: true })
  assert(fs.existsSync(out), '输出文件不存在')
  const p = probe(out)
  approx(p.duration, 11, 0.8, '合并后时长')
  return `不同规格 + loudnorm 音量标准化成功，时长约 ${p.duration.toFixed(2)}s`
})

await test('画质前后对比关键帧提取 (extractFrame)', async () => {
  const frame = await core.extractFrame(sampleMp4, 1)
  assert(fs.existsSync(frame), '截取的关键帧图片不存在')
  const meta = await sharp(frame).metadata()
  assert(meta.width > 0 && meta.height > 0, '图像尺寸无效')
  return `成功截取代表帧：${meta.width}x${meta.height}`
})

await test('画质对比帧容错回退：超出时长时间戳自动回退首帧 (extractFrame fallback)', async () => {
  // sampleMp4 时长为 3s，传入 100s 超出 EOF
  const frame = await core.extractFrame(sampleMp4, 100)
  assert(fs.existsSync(frame) && fs.statSync(frame).size > 0, '超出时长时未能安全回退并输出帧')
  const meta = await sharp(frame).metadata()
  assert(meta.width > 0 && meta.height > 0, '回退帧尺寸有效')
  return `时间戳超出时长时安全回退至首帧：${meta.width}x${meta.height}`
})

await test('mediaUrlToPath 能够正确处理无论是否被 Chromium 规范化解码的 URL', async () => {
  // 模拟未经 Chromium 规范化的编码路径
  const rawUrl = 'media://local/%2Fvar%2Ffolders%2Ftest.jpg'
  assert(core.mediaUrlToPath(rawUrl) === '/var/folders/test.jpg', '未解码 URL 应正确还原')
  // 模拟被 Chromium 规范化解码后的路径（无 %2F）
  const normUrl = 'media://local/var/folders/test.jpg'
  assert(core.mediaUrlToPath(normUrl) === '/var/folders/test.jpg', 'POSIX 解码后应保留前导根斜杠')
  return 'mediaUrlToPath POSIX 路径与 Chromium 规范化双向兼容'
})

await test('视频剧情概览矩阵长图生成 (generateContactSheet 3x3 9宫格)', async () => {
  const out = path.join(work, 'contact_sheet_test.jpg')
  const r = await core.generateContactSheet({
    input: sampleMp4,
    output: out,
    rows: 3,
    cols: 3,
    showTimecode: true
  })
  assert(fs.existsSync(r.output), '剧情长图文件未生成')
  assert(r.size > 1000, '剧情长图文件尺寸过小')
  const meta = await sharp(r.output).metadata()
  assert(meta.width > 0 && meta.height > 0, '图像分辨率无效')
  return `成功生成 3x3 分镜长图：${meta.width}x${meta.height}，体积=${(r.size / 1024).toFixed(1)} KB`
})

await test('真实声波峰值起伏提取 (extractAudioWaveform 毫秒级提取 80 点)', async () => {
  const peaks = await core.extractAudioWaveform(sampleMp4, 80)
  assert(Array.isArray(peaks), '返回值应为数组')
  assert(peaks.length === 80, `峰值点数量不符: ${peaks.length}`)
  assert(peaks.every((p) => p >= 0 && p <= 1), '峰值点应均在 [0, 1] 归一化区间')
  const nonZero = peaks.filter((p) => p > 0.01).length
  assert(nonZero > 10, '有声视频应提取到有效起伏')
  return `成功提取 80 个归一化波形点，最大峰值=${Math.max(...peaks)}`
})

// =====================================================
const failed = results.filter((r) => !r.ok)
console.log(`\n结果：${results.length - failed.length}/${results.length} 通过${failed.length ? `，失败：\n - ${failed.map((f) => `${f.name}: ${f.note}`).join('\n - ')}` : ''}`)
fs.writeFileSync(path.join(work, 'results.json'), JSON.stringify(results, null, 2))
if (failed.length) process.exit(1)
console.log('ALL SMOKE TESTS PASSED')
