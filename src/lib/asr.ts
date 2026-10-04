import type { Cue } from '@/types'

export interface AsrCallbacks {
  /** 模型下载进度 0-1，stage 用于区分阶段 */
  onModelProgress?: (file: string, progress: number, loaded?: boolean) => void
  onStage?: (stage: 'model' | 'transcribe') => void
}

/** 解码音轨并重采样为 16kHz 单声道（Whisper 输入格式） */
export async function extractMono16k(file: Blob): Promise<Float32Array> {
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
  const sr = audio.sampleRate
  const ch = audio.getChannelData(0)
  const target = 16000
  const outLen = Math.floor((ch.length / sr) * target)
  const out = new Float32Array(outLen)
  const ratio = sr / target
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio
    const i0 = Math.floor(pos)
    const i1 = Math.min(ch.length - 1, i0 + 1)
    const frac = pos - i0
    out[i] = ch[i0] * (1 - frac) + ch[i1] * frac
  }
  return out
}

/**
 * 在 Web Worker 中运行语音识别，返回带时间轴的字幕。
 */
export function transcribeInWorker(
  audio: Float32Array,
  duration: number,
  cb: AsrCallbacks = {},
): Promise<Cue[]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../workers/asr.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data
      if (msg.type === 'model-progress') {
        const p = msg.data
        cb.onModelProgress?.(p.file ?? '', typeof p.progress === 'number' ? p.progress / 100 : 0, p.status === 'done')
      } else if (msg.type === 'stage') {
        cb.onStage?.(msg.stage)
      } else if (msg.type === 'done') {
        worker.terminate()
        resolve(msg.cues as Cue[])
      } else if (msg.type === 'error') {
        worker.terminate()
        reject(new Error(msg.message))
      }
    }
    worker.onerror = (err) => {
      worker.terminate()
      reject(new Error(err.message || '语音识别 worker 加载失败'))
    }
    worker.postMessage({ audio, duration }, [audio.buffer])
  })
}
