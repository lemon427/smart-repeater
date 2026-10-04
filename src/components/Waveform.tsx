import { useEffect, useRef } from 'react'
import { fmtTime } from '@/lib/format'
import type { Mode, Segment } from '@/types'

const fmtTimeShort = (t: number) => fmtTime(t).slice(3) // 取 mm:ss.d 部分

interface WaveformProps {
  envelope: Float32Array | null
  windowSec: number
  duration: number
  currentTime: number
  segments: Segment[]
  aPoint: number | null
  bPoint: number | null
  currentSegIdx: number
  mode: Mode
  onSeek: (t: number) => void
  onAddBoundary: (t: number) => void
}

const C = {
  played: '#d9c53a',
  pending: '#6b7280',
  playedDim: '#8a7d2a',
  abFill: 'rgba(34, 197, 94, 0.28)',
  aLine: '#22c55e',
  bLine: '#ef4444',
  tick: 'rgba(255,255,255,0.75)',
  playhead: '#ffffff',
}

export default function Waveform({
  envelope,
  windowSec,
  duration,
  currentTime,
  segments,
  aPoint,
  bPoint,
  currentSegIdx,
  mode,
  onSeek,
  onAddBoundary,
}: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const latest = useRef({ onSeek, onAddBoundary, mode, duration })
  latest.current = { onSeek, onAddBoundary, mode, duration }

  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)

    const resize = () => {
      const w = wrap.clientWidth
      const h = wrap.clientHeight
      canvas.width = w * dpr
      canvas.height = h * dpr
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(wrap)

    const draw = () => {
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const w = canvas.width / dpr
      const h = canvas.height / dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)

      const xOf = (t: number) => (t / duration) * w
      const tOf = (x: number) => Math.min(duration, Math.max(0, (x / w) * duration))

      // AB 区间底色
      if (aPoint != null && bPoint != null && bPoint > aPoint) {
        ctx.fillStyle = C.abFill
        ctx.fillRect(xOf(aPoint), 0, xOf(bPoint) - xOf(aPoint), h)
      }

      // 波形柱
      const env = envelope
      const barW = 2
      const gap = 1
      const step = barW + gap
      const mid = h * 0.55
      const maxTop = h * 0.42
      const n = env ? env.length : 0
      for (let x = 0; x < w; x += step) {
        const t = tOf(x + step / 2)
        let v = 0
        if (env && n > 0) {
          const i0 = Math.floor(t / windowSec)
          const i1 = Math.max(i0 + 1, Math.floor((t + (step / w) * duration) / windowSec))
          for (let i = i0; i < Math.min(i1, n); i++) v = Math.max(v, env[i])
        }
        const played = t <= currentTime
        ctx.fillStyle = played ? C.played : C.pending
        const bh = Math.max(2, Math.min(1, v * 3.2) * maxTop * 2)
        ctx.fillRect(x, mid - bh / 2, barW, bh)
      }

      // 当前句子：醒目填充 + 描边
      if (segments[currentSegIdx]) {
        const s = segments[currentSegIdx]
        const sx = xOf(s.start)
        const sw = Math.max(1, xOf(s.end) - xOf(s.start))
        ctx.fillStyle = 'rgba(217,197,58,0.12)'
        ctx.fillRect(sx, 0, sw, h)
        ctx.strokeStyle = '#e3c93a'
        ctx.lineWidth = 2.5
        ctx.strokeRect(sx + 1, 9, sw - 2, h - 18)
      }

      // 断句刻度
      ctx.fillStyle = C.tick
      for (let i = 1; i < segments.length; i++) {
        ctx.fillRect(xOf(segments[i].start), 0, 1, 8)
      }

      // A / B 标记：粗线 + 顶部三角旗标 + 时间文字
      const marker = (t: number, color: string, label: string) => {
        const x = xOf(t)
        ctx.strokeStyle = color
        ctx.lineWidth = 3
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, h)
        ctx.stroke()
        // 顶部三角旗
        ctx.fillStyle = color
        ctx.beginPath()
        ctx.moveTo(x - 7, 0)
        ctx.lineTo(x + 7, 0)
        ctx.lineTo(x, 10)
        ctx.closePath()
        ctx.fill()
        // 圆形字母标
        ctx.beginPath()
        ctx.arc(x, h - 12, 8, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = '#0b0b0f'
        ctx.font = 'bold 10px sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(label, x, h - 12)
        // 时间文字（旗标下方）
        ctx.fillStyle = color
        ctx.font = 'bold 9px monospace'
        ctx.fillText(fmtTimeShort(t), x, 18)
      }
      if (aPoint != null) marker(aPoint, C.aLine, 'A')
      if (bPoint != null) marker(bPoint, C.bLine, 'B')

      // 播放头
      const px = xOf(currentTime)
      ctx.strokeStyle = C.playhead
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(px, 0)
      ctx.lineTo(px, h)
      ctx.stroke()
      ctx.fillStyle = C.playhead
      ctx.beginPath()
      ctx.arc(px, h * 0.5, 5, 0, Math.PI * 2)
      ctx.fill()
    }

    draw()
    return () => {
      ro.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [envelope, windowSec, duration, segments, aPoint, bPoint, currentSegIdx, currentTime, mode])

  const posToTime = (e: React.PointerEvent) => {
    const rect = wrapRef.current!.getBoundingClientRect()
    const x = e.clientX - rect.left
    return Math.min(duration, Math.max(0, (x / rect.width) * duration))
  }

  const dragging = useRef(false)

  return (
    <div
      ref={wrapRef}
      className="relative h-24 w-full touch-none select-none cursor-crosshair"
      onPointerDown={(e) => {
        dragging.current = true
        ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
        const t = posToTime(e)
        if (latest.current.mode === 'manual') latest.current.onAddBoundary(t)
        else latest.current.onSeek(t)
      }}
      onPointerMove={(e) => {
        if (!dragging.current) return
        const t = posToTime(e)
        if (latest.current.mode !== 'manual') latest.current.onSeek(t)
      }}
      onPointerUp={() => (dragging.current = false)}
      onPointerCancel={() => (dragging.current = false)}
    >
      <canvas ref={canvasRef} className="absolute inset-0" />
    </div>
  )
}
