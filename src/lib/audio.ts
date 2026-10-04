import type { AnalysisOptions, AnalysisResult, Segment } from '@/types'

export const DEFAULT_OPTIONS: AnalysisOptions = {
  minGapMs: 350,
  minSegMs: 400,
  maxSegMs: 9000,
  sensitivity: 0.5,
}

/**
 * 解码视频文件的音轨，计算 RMS 能量包络。
 */
export async function decodeEnvelope(file: Blob): Promise<{
  envelope: Float32Array
  windowSec: number
  duration: number
}> {
  const buf = await file.arrayBuffer()
  const AC: typeof AudioContext =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  const ctx = new AC()
  let audio: AudioBuffer
  try {
    audio = await ctx.decodeAudioData(buf)
  } finally {
    void ctx.close()
  }
  const ch = audio.getChannelData(0)
  const sr = audio.sampleRate
  const win = Math.floor(sr * 0.03) // 30ms 窗口
  const n = Math.max(1, Math.floor(ch.length / win))
  const env = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let sum = 0
    const base = i * win
    for (let j = 0; j < win; j += 4) {
      const v = ch[base + j] || 0
      sum += v * v
    }
    env[i] = Math.sqrt(sum / (win / 4))
  }
  // 3 点滑动平均平滑
  const smoothed = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const a = env[Math.max(0, i - 1)]
    const b = env[i]
    const c = env[Math.min(n - 1, i + 1)]
    smoothed[i] = (a + b + c) / 3
  }
  return { envelope: smoothed, windowSec: win / sr, duration: audio.duration }
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * p)))
  return sorted[idx]
}

/**
 * 基于静音检测的智能断句：
 * 1. 能量低于自适应阈值的连续区间且时长 >= minGapMs → 断句点
 * 2. 过短的句子向能量更高的邻居合并
 * 3. 过长的句子在能量最低点再切一刀
 */
export function detectSegments(
  envelope: Float32Array,
  windowSec: number,
  duration: number,
  opts: AnalysisOptions,
): Segment[] {
  const n = envelope.length
  if (n === 0) return [{ id: 1, start: 0, end: duration }]

  const sorted = Array.from(envelope).sort((a, b) => a - b)
  const floor = percentile(sorted, 0.2)
  const peak = percentile(sorted, 0.95)
  // sensitivity 0→1 时阈值从 peak*0.15 降到 peak*0.03
  const thresh = Math.max(1e-4, Math.max(floor * 1.15, peak * (0.15 - opts.sensitivity * 0.12)))

  const minGapWin = Math.max(2, Math.round(opts.minGapMs / 1000 / windowSec))

  // 找静音区间
  const boundaries: number[] = [] // 单位：窗口下标（断句点取静音区间中点）
  let runStart = -1
  for (let i = 0; i < n; i++) {
    if (envelope[i] < thresh) {
      if (runStart < 0) runStart = i
    } else if (runStart >= 0) {
      const len = i - runStart
      if (len >= minGapWin) {
        boundaries.push((runStart + i) / 2)
      }
      runStart = -1
    }
  }
  // 结尾仍在静音中：若尾部静音足够长也断句
  if (runStart >= 0 && n - runStart >= minGapWin) {
    boundaries.push((runStart + n) / 2)
  }

  let segs: Segment[] = []
  let prev = 0
  let id = 1
  for (const b of boundaries) {
    const t = Math.min(duration, b * windowSec)
    if (t - prev > 0.05) segs.push({ id: id++, start: prev, end: t })
    prev = t
  }
  if (duration - prev > 0.05) segs.push({ id: id++, start: prev, end: duration })
  if (segs.length === 0) segs = [{ id: 1, start: 0, end: duration }]

  // 合并过短句子：并入两侧中能量较高的一侧
  const segEnergy = (s: Segment) => {
    const a = Math.floor(s.start / windowSec)
    const b = Math.max(a + 1, Math.ceil(s.end / windowSec))
    let sum = 0
    for (let i = a; i < Math.min(b, n); i++) sum += envelope[i]
    return sum / (b - a)
  }
  const minSeg = opts.minSegMs / 1000
  let changed = true
  while (changed && segs.length > 1) {
    changed = false
    const idx = segs.findIndex((s) => s.end - s.start < minSeg)
    if (idx < 0) break
    changed = true
    if (idx === 0) {
      segs[1] = { ...segs[1], start: segs[0].start }
      segs.splice(0, 1)
    } else if (idx === segs.length - 1) {
      segs[idx - 1] = { ...segs[idx - 1], end: segs[idx].end }
      segs.splice(idx, 1)
    } else {
      if (segEnergy(segs[idx - 1]) > segEnergy(segs[idx + 1])) {
        segs[idx - 1] = { ...segs[idx - 1], end: segs[idx].end }
      } else {
        segs[idx + 1] = { ...segs[idx + 1], start: segs[idx].start }
      }
      segs.splice(idx, 1)
    }
  }

  // 超长句子在能量最低点切分
  const maxSeg = opts.maxSegMs / 1000
  const out: Segment[] = []
  for (const s of segs) {
    if (s.end - s.start <= maxSeg) {
      out.push(s)
      continue
    }
    let cur = s.start
    while (s.end - cur > maxSeg) {
      const a = Math.floor((cur + maxSeg * 0.5) / windowSec)
      const b = Math.floor((cur + maxSeg) / windowSec)
      let minI = a
      for (let i = a; i < Math.min(b, n); i++) {
        if (envelope[i] < envelope[minI]) minI = i
      }
      const cut = Math.min(s.end, minI * windowSec)
      out.push({ id: 0, start: cur, end: cut })
      cur = cut
    }
    out.push({ id: 0, start: cur, end: s.end })
  }
  return out.map((s, i) => ({ ...s, id: i + 1 }))
}

export async function analyzeAudio(file: Blob, opts: AnalysisOptions): Promise<AnalysisResult> {
  const { envelope, windowSec, duration } = await decodeEnvelope(file)
  const segments = detectSegments(envelope, windowSec, duration, opts)
  return { envelope, windowSec, duration, segments }
}
