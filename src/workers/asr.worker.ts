/// <reference lib="webworker" />
/* eslint-disable @typescript-eslint/no-explicit-any */
// 在 Web Worker 中运行 Whisper 语音识别（transformers.js），避免阻塞界面。
// 模型与 WASM 运行时全部内置在应用本地（public/models、public/ort），无需联网下载。

import { env, pipeline } from '@xenova/transformers'

env.allowLocalModels = true
env.localModelPath = '/models/'
// 本地 WASM 运行时（不依赖 CDN）
if (env.backends?.onnx?.wasm) {
  env.backends.onnx.wasm.wasmPaths = '/ort/'
}

const ctx = self as unknown as Worker

ctx.onmessage = async (e: MessageEvent) => {
  const { audio, duration } = e.data as { audio: Float32Array; duration: number }
  try {
    ctx.postMessage({ type: 'stage', stage: 'model' })
    const pipe = await pipeline('automatic-speech-recognition', 'whisper-tiny', {
      quantized: true,
      progress_callback: (p: any) => {
        if (p && (p.status === 'progress' || p.status === 'initiate' || p.status === 'done')) {
          ctx.postMessage({ type: 'model-progress', data: p })
        }
      },
    })
    ctx.postMessage({ type: 'stage', stage: 'transcribe' })
    const result: any = await pipe(audio, {
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: true,
      task: 'transcribe',
    })
    const chunks: { timestamp: [number, number]; text: string }[] = result.chunks ?? []
    const cues = chunks
      .map((c) => ({
        start: Math.max(0, c.timestamp[0]),
        end: Math.min(duration || Infinity, c.timestamp[1] > c.timestamp[0] ? c.timestamp[1] : c.timestamp[0] + 2),
        text: c.text.trim(),
      }))
      .filter((c) => c.text)
    ctx.postMessage({ type: 'done', cues })
  } catch (err) {
    ctx.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}

export {}
