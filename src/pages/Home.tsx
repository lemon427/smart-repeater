import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Upload,
  Play,
  Pause,
  Scissors,
  Merge,
  Trash2,
  ListMusic,
  Mic,
  Sparkles,
  Loader2,
  Bookmark,
  Settings2,
  SkipBack,
  SkipForward,
  Captions,
  FileText,
  History,
  X,
} from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import Waveform from '@/components/Waveform'
import ProgressBar from '@/components/ProgressBar'
import WheelPicker from '@/components/WheelPicker'
import { analyzeAudio, DEFAULT_OPTIONS } from '@/lib/audio'
import { extractMono16k, transcribeInWorker } from '@/lib/asr'
import { parseSubtitle, cuesToSegments } from '@/lib/subtitles'
import { fmtTime } from '@/lib/format'
import { useHold } from '@/hooks/useHold'
import { listHistory, getHistoryFile, deleteHistory, saveToHistory, type HistoryMeta } from '@/lib/history'
import { setupAutoUpdate, type UpdateInfo } from '@/lib/updater'
import type { Cue, Mode, RepeatCount, Segment } from '@/types'

const SPEEDS = [0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.35, 1.5, 1.75, 2.0]
const SPEED_OPTIONS = SPEEDS.map((s) => ({ label: `${s}x`, value: s }))
const REPEATS: { label: string; value: RepeatCount }[] = [
  { label: '不复读', value: 0 },
  { label: '1次', value: 1 },
  { label: '2次', value: 2 },
  { label: '3次', value: 3 },
  { label: '5次', value: 5 },
  { label: '8次', value: 8 },
  { label: '10次', value: 10 },
  { label: '无限', value: Infinity },
]

const TUNE_STEPS = [
  { label: '0.05秒', value: 0.05 },
  { label: '0.1秒', value: 0.1 },
  { label: '0.5秒', value: 0.5 },
]

type AsrStage = 'idle' | 'model' | 'transcribe' | 'done' | 'error'

export default function Home() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const fileRef = useRef<File | null>(null)
  const recRef = useRef<MediaRecorder | null>(null)
  const recChunks = useRef<Blob[]>([])
  const recAudioRef = useRef<HTMLAudioElement | null>(null)

  const [fileName, setFileName] = useState<string | null>(null)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [envelope, setEnvelope] = useState<Float32Array | null>(null)
  const [windowSec, setWindowSec] = useState(0.03)
  const [duration, setDuration] = useState(0)
  const [segments, setSegments] = useState<Segment[]>([])
  const [currentTime, setCurrentTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [mode, setMode] = useState<Mode>('auto')
  const [aPoint, setAPoint] = useState<number | null>(null)
  const [bPoint, setBPoint] = useState<number | null>(null)
  const [abActive, setAbActive] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [repeat, setRepeat] = useState<RepeatCount>(Infinity)
  const [loopCount, setLoopCount] = useState(0)
  const [autoNext, setAutoNext] = useState(true)
  const [currentSegIdx, setCurrentSegIdx] = useState(0)
  const [showList, setShowList] = useState(false)
  const [minGapMs, setMinGapMs] = useState(DEFAULT_OPTIONS.minGapMs)
  const [sensitivity, setSensitivity] = useState(DEFAULT_OPTIONS.sensitivity * 100)
  const [recording, setRecording] = useState(false)
  const [recUrl, setRecUrl] = useState<string | null>(null)
  const [recError, setRecError] = useState<string | null>(null)
  const [tuneStep, setTuneStep] = useState(0.1)
  // 字幕
  const [cues, setCues] = useState<Cue[] | null>(null)
  const [subtitleSource, setSubtitleSource] = useState<'asr' | 'srt' | null>(null)
  const [asrStage, setAsrStage] = useState<AsrStage>('idle')
  const [asrProgress, setAsrProgress] = useState(0)
  const [asrMsg, setAsrMsg] = useState('')
  const [showCueList, setShowCueList] = useState(false)
  // 历史记录 / 热更新
  const [showHistory, setShowHistory] = useState(false)
  const [historyList, setHistoryList] = useState<HistoryMeta[]>([])
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)

  // 供 rAF 循环读取的最新值，避免闭包过期
  const abRef = useRef({ a: null as number | null, b: null as number | null, active: false, repeat: Infinity as number })
  const loopCountRef = useRef(0)
  const segmentsRef = useRef<Segment[]>([])
  segmentsRef.current = segments
  const followRef = useRef(true)
  const autoNextRef = useRef(autoNext)
  autoNextRef.current = autoNext

  useEffect(() => {
    abRef.current = { a: aPoint, b: bPoint, active: abActive, repeat }
  }, [aPoint, bPoint, abActive, repeat])

  const resetLoop = useCallback(() => {
    loopCountRef.current = 0
    setLoopCount(0)
  }, [])

  const seek = useCallback((t: number) => {
    const v = videoRef.current
    const tt = Math.min(duration || Infinity, Math.max(0, t))
    if (v) v.currentTime = tt
    setCurrentTime(tt)
  }, [duration])

  const play = useCallback(() => {
    const v = videoRef.current
    if (v && !v.ended) {
      v.playbackRate = speed
      void v.play()
    }
  }, [speed])

  const selectSegment = useCallback((i: number, autoplay = true) => {
    const segs = segmentsRef.current
    if (!segs.length) return
    const idx = Math.max(0, Math.min(segs.length - 1, i))
    followRef.current = false
    setCurrentSegIdx(idx)
    const s = segs[idx]
    setAPoint(s.start)
    setBPoint(s.end)
    setAbActive(true)
    resetLoop()
    seek(s.start)
    if (autoplay) play()
    window.setTimeout(() => (followRef.current = true), 300)
  }, [play, resetLoop, seek])

  const selectSegRef = useRef(selectSegment)
  selectSegRef.current = selectSegment

  /** 播放主循环：刷新进度、AB 回跳、复读结束自动跳下一句、跟随高亮 */
  useEffect(() => {
    let raf = 0
    const tick = () => {
      const v = videoRef.current
      if (v) {
        const t = v.currentTime
        setCurrentTime(t)
        const segs = segmentsRef.current
        let idx = -1
        if (followRef.current) {
          idx = segs.findIndex((s) => t >= s.start && t < s.end)
          if (idx >= 0) setCurrentSegIdx(idx)
        }
        const { a, b, active, repeat: rp } = abRef.current
        if (active && rp !== 0 && a != null && b != null && b - a > 0.02 && t >= b - 0.015) {
          if (rp !== Infinity && loopCountRef.current + 1 > rp) {
            loopCountRef.current = 0
            setLoopCount(0)
            const cur = idx >= 0 ? idx : segs.findIndex((s) => (a ?? 0) >= s.start && (a ?? 0) < s.end)
            if (autoNextRef.current && cur >= 0 && cur < segs.length - 1) {
              // 复读次数用完：自动跳到下一句
              selectSegRef.current(cur + 1)
            } else {
              v.pause()
              v.currentTime = a ?? 0
            }
          } else {
            v.currentTime = a ?? 0
            loopCountRef.current += 1
            setLoopCount(loopCountRef.current)
          }
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  const runAnalysis = useCallback(async (file: File) => {
    setAnalyzing(true)
    try {
      const res = await analyzeAudio(file, {
        ...DEFAULT_OPTIONS,
        minGapMs,
        sensitivity: sensitivity / 100,
      })
      setEnvelope(res.envelope)
      setWindowSec(res.windowSec)
      setDuration(res.duration)
      setSegments(res.segments)
      setCurrentSegIdx(0)
      if (res.segments[0]) {
        setAPoint(res.segments[0].start)
        setBPoint(res.segments[0].end)
        setAbActive(true)
      }
      resetLoop()
    } catch {
      // 无音轨或解码失败：整段作为一个句子
      setSegments((prev) => (prev.length ? prev : [{ id: 1, start: 0, end: duration || 0 }]))
    } finally {
      setAnalyzing(false)
    }
  }, [minGapMs, sensitivity, duration, resetLoop])

  const loadFile = useCallback(async (file: File) => {
    if (videoUrl) URL.revokeObjectURL(videoUrl)
    fileRef.current = file
    setFileName(file.name)
    setVideoUrl(URL.createObjectURL(file))
    setEnvelope(null)
    setSegments([])
    setAPoint(null)
    setBPoint(null)
    setAbActive(false)
    setCurrentSegIdx(0)
    setCurrentTime(0)
    setLoopCount(0)
    setCues(null)
    setSubtitleSource(null)
    setAsrStage('idle')
    setAsrMsg('')
    // 存入历史记录（示例视频除外）
    if (!file.name.startsWith('示例视频 demo')) {
      void saveToHistory(file, file.name, file.type).then(() => {
        void listHistory().then(setHistoryList)
      })
    }
    await runAnalysis(file)
  }, [videoUrl, runAnalysis])

  /** 打开历史记录面板 */
  const openHistory = useCallback(async () => {
    setHistoryList(await listHistory())
    setShowHistory(true)
  }, [])

  /** 从历史记录打开文件 */
  const openHistoryItem = useCallback(async (id: string) => {
    const rec = await getHistoryFile(id)
    if (!rec) return
    setShowHistory(false)
    await loadFile(new File([rec.blob], rec.name, { type: rec.type || rec.blob.type }))
  }, [loadFile])

  /** 应用启动：检查热更新（仅原生生效，网页版自动跳过） */
  useEffect(() => {
    void setupAutoUpdate((info) => {
      setUpdateInfo(info)
      if (info.state === 'updated') {
        window.setTimeout(() => setUpdateInfo(null), 6000)
      }
    })
  }, [])

  const loadDemo = useCallback(async () => {
    try {
      const res = await fetch('./demo.mp4')
      if (!res.ok) return
      const blob = await res.blob()
      const file = new File([blob], '示例视频 demo.mp4', { type: 'video/mp4' })
      await loadFile(file)
    } catch {
      /* 无示例视频时忽略 */
    }
  }, [loadFile])

  const togglePlay = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) {
      if (v.ended || v.currentTime >= (duration || 0) - 0.05) {
        v.currentTime = aPoint ?? 0
      }
      play()
    } else {
      v.pause()
    }
  }, [duration, aPoint, play])

  const prevSentence = useCallback(() => selectSegment(currentSegIdx - 1), [currentSegIdx, selectSegment])
  const nextSentence = useCallback(() => selectSegment(currentSegIdx + 1), [currentSegIdx, selectSegment])

  /** AB 微调（带边界钳制） */
  const tune = useCallback((which: 'A' | 'B', dir: 1 | -1) => {
    const step = tuneStep * dir
    if (which === 'A') {
      setAPoint((a) => {
        if (a == null) return a
        const hi = (bPoint ?? duration) - tuneStep
        return Math.max(0, Math.min(hi, a + step))
      })
    } else {
      setBPoint((b) => {
        if (b == null) return b
        const lo = (aPoint ?? 0) + tuneStep
        return Math.max(lo, Math.min(duration || Infinity, b + step))
      })
    }
    resetLoop()
  }, [aPoint, bPoint, duration, resetLoop, tuneStep])

  const setAHere = useCallback(() => {
    setAPoint(currentTime)
    setAbActive(true)
    resetLoop()
  }, [currentTime, resetLoop])
  const setBHere = useCallback(() => {
    setBPoint(currentTime)
    setAbActive(true)
    resetLoop()
  }, [currentTime, resetLoop])

  /** 手动断句：在 t 处插入断点 */
  const addBoundary = useCallback((t: number) => {
    const segs = segmentsRef.current
    const idx = segs.findIndex((s) => t > s.start + 0.05 && t < s.end - 0.05)
    if (idx < 0) {
      seek(t)
      return
    }
    const next = [...segs]
    const s = segs[idx]
    next.splice(idx, 1, { id: 0, start: s.start, end: t }, { id: 0, start: t, end: s.end })
    const re = next.map((x, i) => ({ ...x, id: i + 1 }))
    setSegments(re)
    seek(t)
  }, [seek])

  const splitHere = useCallback(() => addBoundary(currentTime), [addBoundary, currentTime])

  const mergeNext = useCallback(() => {
    const segs = segmentsRef.current
    const i = currentSegIdx
    if (i < 0 || i >= segs.length - 1) return
    const next = [...segs]
    next[i] = { ...next[i], end: next[i + 1].end }
    next.splice(i + 1, 1)
    setSegments(next.map((x, k) => ({ ...x, id: k + 1 })))
    setCurrentSegIdx(i)
  }, [currentSegIdx])

  const removeCurrent = useCallback(() => {
    const segs = segmentsRef.current
    if (segs.length <= 1) return
    const i = currentSegIdx
    const next = [...segs]
    if (i === 0) {
      next.splice(0, 1)
    } else {
      next[i - 1] = { ...next[i - 1], end: next[i].end }
      next.splice(i, 1)
    }
    const re = next.map((x, k) => ({ ...x, id: k + 1 }))
    setSegments(re)
    setCurrentSegIdx(Math.max(0, Math.min(i, re.length - 1)))
  }, [currentSegIdx])

  const changeSpeed = useCallback((s: number) => {
    setSpeed(s)
    if (videoRef.current) videoRef.current.playbackRate = s
  }, [])

  /** 语音识别生成字幕（浏览器本地运行 Whisper，无需上传） */
  const generateSubtitles = useCallback(async () => {
    const file = fileRef.current
    if (!file || asrStage === 'model' || asrStage === 'transcribe') return
    setAsrStage('model')
    setAsrProgress(0)
    setAsrMsg('')
    try {
      const audio = await extractMono16k(file)
      const result = await transcribeInWorker(audio, duration, {
        onModelProgress: (_file, p) => setAsrProgress(p),
        onStage: (stage) => setAsrStage(stage),
      })
      if (!result.length) {
        setAsrStage('error')
        setAsrMsg('未能识别到语音内容')
        return
      }
      setCues(result)
      setSubtitleSource('asr')
      setAsrStage('done')
    } catch (err) {
      setAsrStage('error')
      setAsrMsg(err instanceof Error ? err.message : '识别失败，可尝试导入字幕文件')
    }
  }, [asrStage, duration])

  /** 导入 SRT / VTT 字幕文件 */
  const importSubtitle = useCallback(async (file: File) => {
    try {
      const text = await file.text()
      const parsed = parseSubtitle(text)
      if (!parsed.length) {
        setAsrStage('error')
        setAsrMsg('字幕文件解析失败，请检查 SRT/VTT 格式')
        return
      }
      setCues(parsed)
      setSubtitleSource('srt')
      setAsrStage('done')
      setAsrMsg('')
    } catch {
      setAsrStage('error')
      setAsrMsg('字幕文件读取失败')
    }
  }, [])

  /** 用字幕时间轴作为复读句子 */
  const applyCuesAsSegments = useCallback(() => {
    if (!cues?.length) return
    const segs = cuesToSegments(cues)
    setSegments(segs)
    setCurrentSegIdx(0)
    setAPoint(segs[0].start)
    setBPoint(segs[0].end)
    setAbActive(true)
    resetLoop()
    seek(segs[0].start)
  }, [cues, resetLoop, seek])

  /** 跟读录音 */
  const toggleRecord = useCallback(async () => {
    if (recording) {
      recRef.current?.stop()
      setRecording(false)
      return
    }
    setRecError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      recChunks.current = []
      const mr = new MediaRecorder(stream)
      recRef.current = mr
      mr.ondataavailable = (e) => {
        if (e.data.size) recChunks.current.push(e.data)
      }
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
        const blob = new Blob(recChunks.current, { type: mr.mimeType || 'audio/webm' })
        if (recUrl) URL.revokeObjectURL(recUrl)
        const url = URL.createObjectURL(blob)
        setRecUrl(url)
        const audio = new Audio(url)
        recAudioRef.current = audio
        void audio.play()
      }
      mr.start()
      setRecording(true)
    } catch {
      setRecError('无法访问麦克风')
    }
  }, [recording, recUrl])

  /** 键盘快捷键 */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return
      if (e.code === 'Space') {
        e.preventDefault()
        togglePlay()
      } else if (e.key === 'ArrowLeft') prevSentence()
      else if (e.key === 'ArrowRight') nextSentence()
      else if (e.key === 'a' || e.key === 'A') setAHere()
      else if (e.key === 'b' || e.key === 'B') setBHere()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [togglePlay, prevSentence, nextSentence, setAHere, setBHere])

  const tuneA_L = useHold(() => tune('A', -1))
  const tuneA_R = useHold(() => tune('A', 1))
  const tuneB_L = useHold(() => tune('B', -1))
  const tuneB_R = useHold(() => tune('B', 1))

  const modeTabs: { key: Mode; label: string }[] = [
    { key: 'auto', label: '智能断句' },
    { key: 'manual', label: '手动断句' },
    { key: 'ab', label: 'AB模式' },
  ]

  const holdProps = (h: ReturnType<typeof useHold>) => ({
    onPointerDown: h.onPointerDown,
    onPointerUp: h.onPointerUp,
    onPointerLeave: h.onPointerLeave,
    onPointerCancel: h.onPointerCancel,
  })

  const controlBtn =
    'flex flex-col items-center gap-0.5 rounded-lg bg-[#34343f] px-1 py-1.5 text-[10px] text-gray-200 active:bg-[#454552] transition-colors select-none touch-none'

  const analyzeNow = useCallback(async () => {
    if (fileRef.current) await runAnalysis(fileRef.current)
  }, [runAnalysis])

  const empty = !videoUrl
  const currentCue = cues?.find((c) => currentTime >= c.start && currentTime < c.end) ?? null
  const asrBusy = asrStage === 'model' || asrStage === 'transcribe'

  return (
    <div className="h-[100dvh] overflow-hidden bg-[#17171d] flex justify-center">
      <div className="w-full max-w-[440px] h-full bg-[#26262e] text-gray-100 flex flex-col shadow-2xl relative">
        {/* 顶栏 */}
        <header className="flex items-center justify-between px-3 h-11 border-b border-[#34343f] shrink-0">
          <div className="flex items-center gap-1.5">
            <ListMusic className="w-4 h-4 text-amber-400" />
            <h1 className="text-sm font-bold tracking-wide">智能复读机</h1>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={openHistory}
              className="flex items-center gap-1 px-2 py-1 rounded-lg bg-[#34343f] text-[11px] text-gray-200 active:bg-[#454552]"
              aria-label="历史记录"
            >
              <History className="w-3.5 h-3.5" />
              历史
            </button>
            <button
              onClick={toggleRecord}
              className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] ${
                recording ? 'bg-red-500/90 text-white animate-pulse' : 'bg-[#34343f] text-gray-200 active:bg-[#454552]'
              }`}
              aria-label="录音跟读"
            >
              <Mic className="w-3.5 h-3.5" />
              {recording ? '停止' : recUrl ? '重录' : '跟读'}
            </button>
            {videoUrl && (
              <Popover>
                <PopoverTrigger asChild>
                  <button className="p-1.5 rounded-lg bg-[#34343f] active:bg-[#454552]" aria-label="断句设置">
                    <Settings2 className="w-3.5 h-3.5" />
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-72 bg-[#2e2e38] border-[#454552] text-gray-100" side="bottom" align="end">
                  <div className="space-y-4 p-1">
                    <div>
                      <div className="text-xs text-gray-400 mb-2">断句灵敏度：{sensitivity}%（越高切得越碎）</div>
                      <Slider value={[sensitivity]} onValueChange={([v]) => setSensitivity(v)} min={0} max={100} step={5} />
                    </div>
                    <div>
                      <div className="text-xs text-gray-400 mb-2">最短静音停顿</div>
                      <Select value={String(minGapMs)} onValueChange={(v) => setMinGapMs(Number(v))}>
                        <SelectTrigger className="bg-[#34343f] border-[#454552] text-gray-100 h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-[#2e2e38] border-[#454552] text-gray-100">
                          <SelectItem value="200">0.2 秒（精细）</SelectItem>
                          <SelectItem value="350">0.35 秒（推荐）</SelectItem>
                          <SelectItem value="500">0.5 秒</SelectItem>
                          <SelectItem value="800">0.8 秒（宽松）</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <button
                      onClick={analyzeNow}
                      disabled={analyzing}
                      className="w-full py-2 rounded-lg bg-amber-500/90 text-black text-sm font-medium active:bg-amber-400 disabled:opacity-50"
                    >
                      {analyzing ? '分析中…' : '重新智能断句'}
                    </button>
                  </div>
                </PopoverContent>
              </Popover>
            )}
            <label className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-500 text-black text-[11px] font-medium active:bg-amber-400 cursor-pointer">
              <Upload className="w-3.5 h-3.5" />
              导入
              <input
                type="file"
                accept="video/*,audio/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void loadFile(f)
                  e.target.value = ''
                }}
              />
            </label>
          </div>
        </header>

        {/* 热更新提示条 */}
        {updateInfo && updateInfo.state !== 'none' && updateInfo.state !== 'checking' && (
          <div
            className={`shrink-0 px-3 py-1 text-[11px] flex items-center gap-2 ${
              updateInfo.state === 'updated'
                ? 'bg-green-500/20 text-green-300'
                : updateInfo.state === 'error'
                  ? 'bg-red-500/15 text-red-300'
                  : 'bg-amber-500/15 text-amber-300'
            }`}
          >
            {updateInfo.state === 'downloading' && <Loader2 className="w-3 h-3 animate-spin shrink-0" />}
            <span className="truncate">
              {updateInfo.state === 'downloading'
                ? `${updateInfo.message ?? '正在下载更新…'} ${Math.round(updateInfo.progress)}%`
                : (updateInfo.message ?? '')}
            </span>
            {updateInfo.state !== 'downloading' && (
              <button onClick={() => setUpdateInfo(null)} className="ml-auto shrink-0 text-gray-400">
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        )}

        {empty ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-6 px-8 text-center">
            <div className="w-20 h-20 rounded-3xl bg-[#34343f] flex items-center justify-center">
              <Sparkles className="w-9 h-9 text-amber-400" />
            </div>
            <div>
              <p className="text-lg font-semibold">导入视频，开始智能复读</p>
              <p className="text-sm text-gray-400 mt-2 leading-relaxed">
                自动识别语音停顿并断句，支持 AB 循环复读、逐句跳转、0.5–2 倍变速、语音识别字幕，学英语练听力必备。
              </p>
            </div>
            <label className="px-6 py-3 rounded-xl bg-amber-500 text-black font-medium active:bg-amber-400 cursor-pointer">
              选择视频 / 音频文件
              <input
                type="file"
                accept="video/*,audio/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void loadFile(f)
                  e.target.value = ''
                }}
              />
            </label>
            <button onClick={loadDemo} className="text-sm text-gray-400 underline underline-offset-4">
              没有文件？先用示例视频试试
            </button>
          </div>
        ) : (
          <>
            {/* 视频区 */}
            <div className="relative bg-black shrink-0">
              <video
                ref={videoRef}
                src={videoUrl!}
                className="w-full h-[140px] object-contain"
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onEnded={() => setPlaying(false)}
                onLoadedMetadata={(e) => {
                  if (!duration) setDuration(e.currentTarget.duration)
                }}
                playsInline
              />
              <button
                onClick={togglePlay}
                className="absolute inset-0 flex items-center justify-center bg-black/20"
                aria-label={playing ? '暂停' : '播放'}
              >
                {!playing && (
                  <span className="w-12 h-12 rounded-full bg-amber-500/90 flex items-center justify-center shadow-lg">
                    <Play className="w-5 h-5 text-black ml-0.5" fill="currentColor" />
                  </span>
                )}
              </button>
              {analyzing && (
                <div className="absolute inset-x-0 bottom-0 bg-black/70 py-1 flex items-center justify-center gap-1.5 text-xs text-amber-300">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  正在智能断句…
                </div>
              )}
            </div>

            {/* 字幕条 */}
            <div className="px-3 pt-1.5 shrink-0">
              <button
                onClick={() => cues && setShowCueList((s) => !s)}
                className={`w-full h-8 rounded-lg px-3 flex items-center justify-center text-center ${
                  cues ? 'bg-black/60 active:bg-black/40' : 'bg-[#2e2e38] border border-dashed border-[#4a4a58]'
                }`}
              >
                {cues ? (
                  <span className="text-[13px] leading-none text-amber-100 truncate">{currentCue?.text ?? '（此处无字幕）'}</span>
                ) : (
                  <span className="text-[10px] text-gray-500 truncate">暂无字幕 · 可生成语音识别字幕或导入 SRT</span>
                )}
              </button>

              {/* 字幕操作行 */}
              <div className="flex items-center gap-1.5 mt-1">
                <button
                  onClick={generateSubtitles}
                  disabled={asrBusy}
                  className="flex-1 flex items-center justify-center gap-1 py-1 rounded-md bg-[#34343f] text-[10px] text-gray-200 active:bg-[#454552] disabled:opacity-50"
                >
                  {asrBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Captions className="w-3 h-3 text-amber-300" />}
                  {subtitleSource === 'asr' ? '重新识别' : '生成字幕'}
                </button>
                <label className="flex-1 flex items-center justify-center gap-1 py-1 rounded-md bg-[#34343f] text-[10px] text-gray-200 active:bg-[#454552] cursor-pointer">
                  <FileText className="w-3 h-3 text-amber-300" />
                  导入字幕
                  <input
                    type="file"
                    accept=".srt,.vtt"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      if (f) void importSubtitle(f)
                      e.target.value = ''
                    }}
                  />
                </label>
                {cues && (
                  <>
                    <button
                      onClick={applyCuesAsSegments}
                      className="flex-1 py-1 rounded-md bg-green-500/80 text-[10px] font-medium text-black active:bg-green-400"
                    >
                      字幕断句
                    </button>
                    <button
                      onClick={analyzeNow}
                      className="flex-1 py-1 rounded-md bg-[#34343f] text-[10px] text-gray-200 active:bg-[#454552]"
                    >
                      智能断句
                    </button>
                  </>
                )}
              </div>

              {/* ASR 状态提示 */}
              {(asrBusy || (asrStage === 'error' && asrMsg)) && (
                <div
                  className={`mt-1 text-[10px] flex items-center gap-1.5 ${
                    asrStage === 'error' ? 'text-red-400' : 'text-amber-300/90'
                  }`}
                >
                  {asrBusy && <Loader2 className="w-3 h-3 animate-spin shrink-0" />}
                  <span className="truncate">
                    {asrStage === 'model'
                      ? `正在加载本地语音识别模型… ${Math.round(asrProgress * 100)}%`
                      : asrStage === 'transcribe'
                        ? '正在识别语音生成字幕…'
                        : asrMsg}
                  </span>
                </div>
              )}

              {/* 字幕列表 */}
              {cues && showCueList && (
                <div className="mt-1 max-h-28 overflow-y-auto rounded-lg bg-[#2e2e38] border border-[#3a3a46] divide-y divide-[#3a3a46]">
                  {cues.map((c, i) => (
                    <button
                      key={i}
                      onClick={() => seek(c.start)}
                      className={`w-full flex items-start gap-2 px-3 py-1.5 text-left active:bg-[#34343f] ${
                        currentCue === c ? 'bg-amber-500/15' : ''
                      }`}
                    >
                      <span className="font-mono text-[10px] text-gray-500 shrink-0 pt-0.5">{fmtTime(c.start)}</span>
                      <span className="text-[11px] text-gray-200 leading-snug">{c.text}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* 可拖动进度条 */}
            <ProgressBar
              duration={duration}
              currentTime={currentTime}
              segments={segments}
              aPoint={aPoint}
              bPoint={bPoint}
              onSeek={seek}
            />

            {/* 文件名 + 时间 */}
            <div className="px-3 pt-0.5 flex items-center justify-between text-[10px] text-gray-500 shrink-0">
              <span className="truncate max-w-[55%]">{fileName}</span>
              <span className="font-mono text-gray-300">
                {fmtTime(currentTime)} / {fmtTime(duration)}
              </span>
            </div>

            {/* 波形 */}
            <div className="px-3 pt-1 shrink-0">
              <div className="rounded-lg bg-[#2e2e38] border border-[#3a3a46] overflow-hidden">
                {envelope ? (
                  <Waveform
                    envelope={envelope}
                    windowSec={windowSec}
                    duration={duration}
                    currentTime={currentTime}
                    segments={segments}
                    aPoint={aPoint}
                    bPoint={bPoint}
                    currentSegIdx={currentSegIdx}
                    mode={mode}
                    onSeek={seek}
                    onAddBoundary={addBoundary}
                  />
                ) : (
                  <div className="h-24 flex items-center justify-center text-xs text-gray-500">
                    {analyzing ? '生成波形中…' : '无波形数据'}
                  </div>
                )}
              </div>
            </div>

            {/* 句子信息 + AB 信息 */}
            <div className="px-3 pt-1.5 flex items-center justify-between gap-2 text-xs shrink-0">
              <div className="flex items-center gap-1">
                <button
                  onClick={() => seek(currentTime - 3)}
                  className="px-1.5 py-0.5 rounded bg-[#34343f] text-[10px] text-gray-300 active:bg-[#454552]"
                >
                  -3秒
                </button>
                <span className="text-amber-300 font-medium text-[11px]">
                  句子 {segments.length ? currentSegIdx + 1 : 0} / {segments.length}
                </span>
                <button
                  onClick={() => seek(currentTime + 3)}
                  className="px-1.5 py-0.5 rounded bg-[#34343f] text-[10px] text-gray-300 active:bg-[#454552]"
                >
                  +3秒
                </button>
              </div>
              <span className="font-mono text-[10px] text-gray-300 text-right">
                A {aPoint != null ? fmtTime(aPoint) : '--:--.-'} · B {bPoint != null ? fmtTime(bPoint) : '--:--.-'}
                {abActive &&
                  (repeat === 0 ? (
                    <span className="text-gray-500 ml-1.5">不复读</span>
                  ) : (
                    <span className="text-green-400 ml-1.5">
                      循环 {repeat === Infinity ? `${loopCount + 1}` : `${Math.min(loopCount + 1, repeat)}/${repeat}`} 次
                    </span>
                  ))}
              </span>
            </div>

            {/* 模式切换 */}
            <div className="px-3 pt-1.5 shrink-0">
              <div className="grid grid-cols-3 gap-1">
                {modeTabs.map((m) => (
                  <button
                    key={m.key}
                    onClick={() => setMode(m.key)}
                    className={`py-1 rounded-md text-[11px] font-medium transition-colors ${
                      mode === m.key ? 'bg-amber-500 text-black' : 'bg-[#34343f] text-gray-300 active:bg-[#454552]'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            {/* AB 微调 */}
            <div className="px-3 pt-1.5 shrink-0">
              <div className="flex items-center justify-between mb-1 px-0.5">
                <span className="text-[10px] text-gray-500">AB 微调 · 长按连调</span>
                <div className="flex gap-1">
                  {TUNE_STEPS.map((s) => (
                    <button
                      key={s.value}
                      onClick={() => setTuneStep(s.value)}
                      className={`px-1.5 py-0.5 rounded-full text-[9px] ${
                        tuneStep === s.value ? 'bg-amber-500 text-black font-medium' : 'bg-[#34343f] text-gray-400'
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                <button {...holdProps(tuneA_L)} className={controlBtn}>
                  <ChevronLeft className="w-4 h-4 text-green-400" />
                  A左
                </button>
                <button {...holdProps(tuneA_R)} className={controlBtn}>
                  <ChevronRight className="w-4 h-4 text-green-400" />
                  A右
                </button>
                <button {...holdProps(tuneB_L)} className={controlBtn}>
                  <ChevronLeft className="w-4 h-4 text-red-400" />
                  B左
                </button>
                <button {...holdProps(tuneB_R)} className={controlBtn}>
                  <ChevronRight className="w-4 h-4 text-red-400" />
                  B右
                </button>
              </div>
            </div>

            {/* 设A设B + 句子编辑 */}
            <div className="px-3 pt-1.5 grid grid-cols-5 gap-1.5 shrink-0">
              <button onClick={setAHere} className={controlBtn}>
                <Bookmark className="w-4 h-4 text-green-400" />
                设A
              </button>
              <button onClick={setBHere} className={controlBtn}>
                <Bookmark className="w-4 h-4 text-red-400" />
                设B
              </button>
              <button onClick={splitHere} className={controlBtn}>
                <Scissors className="w-4 h-4 text-amber-300" />
                分割
              </button>
              <button onClick={mergeNext} className={controlBtn}>
                <Merge className="w-4 h-4 text-amber-300" />
                合并
              </button>
              <button onClick={removeCurrent} className={controlBtn}>
                <Trash2 className="w-4 h-4 text-amber-300" />
                删除
              </button>
            </div>

            {/* 复读次数 / 播放倍速 滚轮 + 自动跳下一句 */}
            <div className="px-3 pt-1.5 shrink-0">
              <div className="flex gap-2">
                <div className="flex-1 rounded-lg bg-[#2e2e38] border border-[#3a3a46] px-2 pt-1 pb-0.5">
                  <div className="text-[9px] text-gray-500 text-center">复读次数</div>
                  <WheelPicker
                    options={REPEATS}
                    value={repeat}
                    onChange={(v) => {
                      setRepeat(v)
                      resetLoop()
                    }}
                  />
                </div>
                <div className="flex-1 rounded-lg bg-[#2e2e38] border border-[#3a3a46] px-2 pt-1 pb-0.5">
                  <div className="text-[9px] text-gray-500 text-center">播放倍速</div>
                  <WheelPicker options={SPEED_OPTIONS} value={speed} onChange={changeSpeed} />
                </div>
                {repeat !== 0 && (
                  <div className="w-[64px] rounded-lg bg-[#2e2e38] border border-[#3a3a46] flex flex-col items-center justify-center gap-1 py-1">
                    <span className="text-[9px] text-gray-500 text-center leading-tight px-0.5">自动跳下一句</span>
                    <Switch checked={autoNext} onCheckedChange={setAutoNext} />
                  </div>
                )}
              </div>
              {recError && <p className="text-[10px] text-red-400 pt-1">{recError}</p>}
            </div>

            {/* 句子列表（默认收起，内部滚动） */}
            <div className="px-3 pt-1 shrink-0">
              <button
                onClick={() => setShowList((s) => !s)}
                className="w-full flex items-center justify-between py-0.5 text-[11px] text-gray-400"
              >
                <span>句子列表（{segments.length} 句）{showList ? '· 收起' : '· 展开可点选跳转'}</span>
                {showList ? <ChevronRight className="w-3.5 h-3.5 rotate-90" /> : <ChevronRight className="w-3.5 h-3.5" />}
              </button>
              {showList && (
                <div className="max-h-28 overflow-y-auto rounded-lg bg-[#2e2e38] border border-[#3a3a46] divide-y divide-[#3a3a46]">
                  {segments.map((s, i) => (
                    <button
                      key={s.id}
                      onClick={() => selectSegment(i)}
                      className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-left ${
                        i === currentSegIdx ? 'bg-amber-500/15' : 'active:bg-[#34343f]'
                      }`}
                    >
                      <span
                        className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                          i === currentSegIdx ? 'bg-amber-500 text-black' : 'bg-[#454552] text-gray-300'
                        }`}
                      >
                        {i + 1}
                      </span>
                      <span className="font-mono text-[10px] text-gray-300">
                        {fmtTime(s.start)} → {fmtTime(s.end)}
                      </span>
                      <span className="ml-auto text-[10px] text-gray-500">{(s.end - s.start).toFixed(1)}s</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* 底部控制栏 */}
            <div className="mt-auto shrink-0 border-t border-[#34343f] bg-[#26262e] px-4 pt-1.5 pb-3">
              <div className="grid grid-cols-3 items-center">
                <button onClick={prevSentence} className="flex flex-col items-center gap-0.5 py-1 text-gray-300 active:text-amber-300">
                  <SkipBack className="w-5 h-5" />
                  <span className="text-[10px]">上一句</span>
                </button>
                <div className="flex justify-center">
                  <button
                    onClick={togglePlay}
                    className="w-12 h-12 rounded-full bg-amber-500 flex items-center justify-center shadow-lg shadow-amber-500/20 active:scale-95 transition-transform"
                    aria-label={playing ? '暂停' : '播放'}
                  >
                    {playing ? (
                      <Pause className="w-5 h-5 text-black" fill="currentColor" />
                    ) : (
                      <Play className="w-5 h-5 text-black ml-0.5" fill="currentColor" />
                    )}
                  </button>
                </div>
                <button onClick={nextSentence} className="flex flex-col items-center gap-0.5 py-1 text-gray-300 active:text-amber-300">
                  <SkipForward className="w-5 h-5" />
                  <span className="text-[10px]">下一句</span>
                </button>
              </div>
            </div>

            {/* 历史记录面板 */}
            {showHistory && (
              <div className="absolute inset-0 z-50 bg-black/70 flex items-end" onClick={() => setShowHistory(false)}>
                <div
                  className="w-full max-h-[70%] bg-[#2e2e38] rounded-t-2xl border-t border-[#454552] flex flex-col"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex items-center justify-between px-4 py-3 border-b border-[#3a3a46]">
                    <span className="text-sm font-medium">历史记录（{historyList.length}）</span>
                    <button onClick={() => setShowHistory(false)} className="p-1 rounded-lg bg-[#34343f] active:bg-[#454552]">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="overflow-y-auto divide-y divide-[#3a3a46]">
                    {historyList.length === 0 && (
                      <p className="px-4 py-6 text-center text-xs text-gray-500">
                        暂无历史记录 · 导入过的视频/音频会自动保存在这里
                      </p>
                    )}
                    {historyList.map((h) => (
                      <div key={h.id} className="flex items-center gap-2 px-4 py-2.5 active:bg-[#34343f]">
                        <button onClick={() => void openHistoryItem(h.id)} className="flex-1 text-left min-w-0">
                          <p className="text-[13px] text-gray-100 truncate">{h.name}</p>
                          <p className="text-[10px] text-gray-500">
                            {new Date(h.addedAt).toLocaleString()} · {(h.size / 1024 / 1024).toFixed(1)} MB
                          </p>
                        </button>
                        <button
                          onClick={() => {
                            void deleteHistory(h.id).then(async () => setHistoryList(await listHistory()))
                          }}
                          className="p-1.5 rounded-lg bg-[#34343f] text-red-400 active:bg-[#454552]"
                          aria-label="删除"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
