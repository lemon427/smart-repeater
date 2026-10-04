import type { Cue } from '@/types'

function tsToSec(ts: string): number {
  const m = ts.trim().replace(',', '.').match(/(?:(\d+):)?(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?/)
  if (!m) return NaN
  const h = m[1] ? parseInt(m[1], 10) : 0
  return h * 3600 + parseInt(m[2], 10) * 60 + parseInt(m[3], 10) + (m[4] ? parseInt(m[4].padEnd(3, '0'), 10) / 1000 : 0)
}

function stripVttHeader(text: string): string {
  // 去掉 WEBVTT 头部与 NOTE 注释
  const lines = text.split(/\r?\n/)
  while (lines.length && (lines[0].trim() === '' || /^WEBVTT/.test(lines[0]) || /^NOTE/.test(lines[0]))) {
    lines.shift()
    if (/^$/.test(lines[0] ?? '')) lines.shift()
  }
  return lines.join('\n')
}

/** 解析 SRT / VTT 字幕内容为 cue 列表 */
export function parseSubtitle(text: string): Cue[] {
  const body = /^WEBVTT/i.test(text) ? stripVttHeader(text) : text
  const blocks = body.replace(/\r/g, '').split(/\n{2,}/)
  const cues: Cue[] = []
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim() !== '')
    if (!lines.length) continue
    let timeLineIdx = 0
    // SRT 块首行可能是序号
    if (!lines[0].includes('-->') && lines.length > 1) timeLineIdx = 1
    const tl = lines[timeLineIdx]
    if (!tl || !tl.includes('-->')) continue
    const [a, b] = tl.split('-->')
    if (!b) continue
    const start = tsToSec(a)
    const end = tsToSec(b.trim().split(/\s+/)[0])
    if (isNaN(start) || isNaN(end) || end <= start) continue
    const content = lines
      .slice(timeLineIdx + 1)
      .join(' ')
      .replace(/<[^>]+>/g, '')
      .trim()
    if (!content) continue
    cues.push({ start, end, text: content })
  }
  return cues.sort((x, y) => x.start - y.start)
}

/** cue 列表 → 复读句子段 */
export function cuesToSegments(cues: Cue[]): { id: number; start: number; end: number }[] {
  return cues.map((c, i) => ({ id: i + 1, start: c.start, end: c.end }))
}
