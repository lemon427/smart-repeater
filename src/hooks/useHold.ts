import { useCallback, useRef } from 'react'

/**
 * 按下立即触发一次，长按 400ms 后连续触发（每 60ms 一次），松开停止。
 */
export function useHold(action: () => void) {
  const timer = useRef<number | null>(null)
  const interval = useRef<number | null>(null)
  const actionRef = useRef(action)
  actionRef.current = action

  const stop = useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current)
    if (interval.current) window.clearInterval(interval.current)
    timer.current = null
    interval.current = null
  }, [])

  const start = useCallback(() => {
    stop()
    actionRef.current()
    timer.current = window.setTimeout(() => {
      interval.current = window.setInterval(() => actionRef.current(), 60)
    }, 400)
  }, [stop])

  return {
    onPointerDown: start,
    onPointerUp: stop,
    onPointerLeave: stop,
    onPointerCancel: stop,
  }
}
