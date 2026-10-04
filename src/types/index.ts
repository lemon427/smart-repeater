export interface Segment {
  id: number
  start: number // seconds
  end: number // seconds
}

export interface AnalysisOptions {
  minGapMs: number // 静音时长超过该值视为断句点
  minSegMs: number // 短于该值的句子自动合并
  maxSegMs: number // 长于该值的句子在中点最低能量处再切
  sensitivity: number // 0-1, 越高越容易断句（阈值越低）
}

export interface AnalysisResult {
  envelope: Float32Array // 能量包络，窗口数 = envelope.length
  windowSec: number // 每个窗口的秒数
  duration: number
  segments: Segment[]
}

export type Mode = 'auto' | 'manual' | 'ab'

export type RepeatCount = number

export interface Cue {
  start: number
  end: number
  text: string
}
