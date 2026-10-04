import { useEffect, useRef, useState } from 'react'

interface WheelOption {
  label: string
  value: number
}

interface WheelPickerProps {
  options: WheelOption[]
  value: number
  onChange: (v: number) => void
}

const ITEM_H = 26
const VISIBLE = 3

/**
 * 上下滚动选择器（滚轮式）：上下滑动切换选项，点击也可选中。
 */
export default function WheelPicker({ options, value, onChange }: WheelPickerProps) {
  const listRef = useRef<HTMLDivElement>(null)
  const userScroll = useRef(false)
  const timer = useRef<number | null>(null)
  const [selIdx, setSelIdx] = useState(() => Math.max(0, options.findIndex((o) => o.value === value)))
  const latest = useRef({ onChange, options })
  latest.current = { onChange, options }

  // 外部值变化时滚动到对应位置
  useEffect(() => {
    const idx = options.findIndex((o) => o.value === value)
    if (idx >= 0 && !userScroll.current) {
      setSelIdx(idx)
      listRef.current?.scrollTo({ top: idx * ITEM_H })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  const settle = () => {
    const el = listRef.current
    if (!el) return
    const i = Math.max(0, Math.min(options.length - 1, Math.round(el.scrollTop / ITEM_H)))
    el.scrollTo({ top: i * ITEM_H, behavior: 'smooth' })
    setSelIdx(i)
    const v = options[i]?.value
    if (v !== undefined) latest.current.onChange(v)
    window.setTimeout(() => (userScroll.current = false), 250)
  }

  const handleScroll = () => {
    userScroll.current = true
    const el = listRef.current
    if (el) {
      const i = Math.max(0, Math.min(options.length - 1, Math.round(el.scrollTop / ITEM_H)))
      setSelIdx(i)
    }
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(settle, 160)
  }

  const pick = (i: number) => {
    userScroll.current = false
    setSelIdx(i)
    listRef.current?.scrollTo({ top: i * ITEM_H, behavior: 'smooth' })
    const v = options[i]?.value
    if (v !== undefined) onChange(v)
  }

  return (
    <div className="relative" style={{ height: ITEM_H * VISIBLE }}>
      {/* 选中行高亮背景 */}
      <div className="absolute left-1 right-1 top-1/2 -translate-y-1/2 h-8 rounded-lg bg-amber-400/10 border border-amber-400/20 pointer-events-none" />
      {/* 上下遮罩 */}
      <div className="absolute inset-x-0 top-0 h-8 bg-gradient-to-b from-[#2e2e38] to-transparent pointer-events-none z-10" />
      <div className="absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-[#2e2e38] to-transparent pointer-events-none z-10" />
      <div
        ref={listRef}
        onScroll={handleScroll}
        className="relative h-full overflow-y-auto no-scrollbar"
      >
        <div style={{ height: ITEM_H }} />
        {options.map((o, i) => (
          <button
            key={o.label}
            style={{ height: ITEM_H }}
            onClick={() => pick(i)}
            className={`w-full flex items-center justify-center text-[13px] transition-all ${
              i === selIdx ? 'text-amber-300 font-bold' : 'text-gray-500'
            }`}
          >
            {o.label}
          </button>
        ))}
        <div style={{ height: ITEM_H }} />
      </div>
    </div>
  )
}
