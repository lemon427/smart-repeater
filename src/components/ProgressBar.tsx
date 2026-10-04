import { useRef, useState } from 'react'
import { fmtTime } from '@/lib/format'
import type { Segment } from '@/types'

interface ProgressBarProps {
  duration: number
  currentTime: number
  segments: Segment[]
  aPoint: number | null
  bPoint: number | null
  onSeek: (t: number) => void
}

/**
 * 可拖动进度条：支持点击/拖动定位，显示断句刻度与 AB 区间。
 */
export default function ProgressBar({
  duration,
  currentTime,
  segments,
  aPoint,
  bPoint,
  onSeek,
}: ProgressBarProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const latest = useRef({ onSeek, duration })
  latest.current = { onSeek, duration }

  const timeAt = (clientX: number) => {
    const rect = trackRef.current!.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    return ratio * latest.current.duration
  }

  const pct = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0

  return (
    <div className="px-3 pt-1.5">
      <div
        ref={trackRef}
        className="relative h-7 flex items-center cursor-pointer touch-none select-none"
        onPointerDown={(e) => {
          setDragging(true)
          ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
          latest.current.onSeek(timeAt(e.clientX))
        }}
        onPointerMove={(e) => {
          if (dragging) latest.current.onSeek(timeAt(e.clientX))
        }}
        onPointerUp={() => setDragging(false)}
        onPointerCancel={() => setDragging(false)}
      >
        {/* 轨道 */}
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-2 rounded-full bg-[#3a3a46] overflow-hidden">
          {/* 已播放 */}
          <div className="h-full bg-gradient-to-r from-amber-500 to-amber-400" style={{ width: `${pct}%` }} />
          {/* AB 区间 */}
          {aPoint != null && bPoint != null && duration > 0 && (
            <div
              className="absolute top-0 h-full bg-green-400/35 border-x border-green-300/60"
              style={{
                left: `${(aPoint / duration) * 100}%`,
                width: `${Math.max(0, ((bPoint - aPoint) / duration) * 100)}%`,
              }}
            />
          )}
          {/* 断句刻度 */}
          {segments.slice(1).map((s) =>
            duration > 0 ? (
              <div
                key={s.id}
                className="absolute top-0 h-full w-px bg-white/50"
                style={{ left: `${(s.start / duration) * 100}%` }}
              />
            ) : null,
          )}
        </div>
        {/* A/B 标记 */}
        {aPoint != null && duration > 0 && (
          <div
            className="absolute top-1/2 -translate-y-1/2 w-0 h-0 border-l-[6px] border-r-[6px] border-b-[9px] border-l-transparent border-r-transparent border-b-green-400 -mt-3.5 pointer-events-none"
            style={{ left: `calc(${(aPoint / duration) * 100}% - 6px)` }}
          />
        )}
        {bPoint != null && duration > 0 && (
          <div
            className="absolute top-1/2 -translate-y-1/2 w-0 h-0 border-l-[6px] border-r-[6px] border-b-[9px] border-l-transparent border-r-transparent border-b-red-400 -mt-3.5 pointer-events-none"
            style={{ left: `calc(${(bPoint / duration) * 100}% - 6px)` }}
          />
        )}
        {/* 播放头 */}
        <div
          className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-4 rounded-full bg-white shadow pointer-events-none transition-transform ${
            dragging ? 'scale-125' : ''
          }`}
          style={{ left: `${pct}%` }}
        />
        {/* 拖动提示 */}
        {dragging && duration > 0 && (
          <div
            className="absolute -top-1 -translate-x-1/2 px-1.5 py-0.5 rounded bg-black/85 text-amber-300 text-[10px] font-mono pointer-events-none"
            style={{ left: `${pct}%` }}
          >
            {fmtTime(currentTime)}
          </div>
        )}
      </div>
    </div>
  )
}
