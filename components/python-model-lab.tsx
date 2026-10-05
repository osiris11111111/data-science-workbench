"use client"

import { useEffect, useRef, useState } from "react"
import { CheckCircle2, CircleAlert, Cpu, Loader2, Play, RotateCcw } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"

type Cell = string | number | boolean | null
type DataRow = Record<string, Cell>
type Task = "regression" | "classification" | "forecast"
type TrainResult = {
  task: Task
  target: string
  rowsUsed: number
  trainRows: number
  testRows: number
  featureCount: number
  split: string
  baseline: { name: string; metrics: Record<string, number> }
  best: { name: string; metrics: Record<string, number> }
  candidates: Array<{ name: string; metrics: Record<string, number> }>
  topFeatures: Array<{ name: string; importance: number }>
  versions: Record<string, string>
  warnings: string[]
}

type WorkerMessage =
  | { type: "progress"; progress: number; message: string }
  | { type: "result"; result: TrainResult }
  | { type: "error"; error: string }

export function PythonModelLab({ rows, target, task }: { rows: DataRow[]; target: string; task: Task }) {
  const workerRef = useRef<Worker | null>(null)
  const [progress, setProgress] = useState(0)
  const [status, setStatus] = useState("等待训练")
  const [result, setResult] = useState<TrainResult | null>(null)
  const [error, setError] = useState("")
  const [running, setRunning] = useState(false)

  useEffect(() => () => workerRef.current?.terminate(), [])

  function train() {
    workerRef.current?.terminate()
    const worker = new Worker("/python-worker.js", { type: "module" })
    workerRef.current = worker
    setRunning(true)
    setResult(null)
    setError("")
    setProgress(2)
    setStatus("正在启动 Python Worker")

    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const message = event.data
      if (message.type === "progress") {
        setProgress(message.progress)
        setStatus(message.message)
      } else if (message.type === "result") {
        setResult(message.result)
        setProgress(100)
        setStatus("训练与测试集评估完成")
        setRunning(false)
      } else {
        setError(message.error)
        setStatus("训练失败")
        setRunning(false)
      }
    }
    worker.onerror = (event) => {
      setError(event.message || "Python Worker 启动失败")
      setRunning(false)
      setStatus("训练失败")
    }

    worker.postMessage({ type: "train", payload: { rows: rows.slice(0, 5000), originalRows: rows.length, target, task, seed: 42 } })
  }

  const primaryMetric = result
    ? task === "classification"
      ? ["F1", result.best.metrics.f1_weighted]
      : ["MAE", result.best.metrics.mae]
    : null

  return (
    <div className="mt-4 border border-cyan-400/15 bg-[#08121b] p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Cpu className="size-4 text-cyan-300" />
            <h3 className="text-sm font-medium">Python 训练运行时</h3>
            <Badge variant="outline" className="border-cyan-400/20 bg-cyan-400/5 text-[10px] text-cyan-300">PYODIDE WORKER</Badge>
          </div>
          <p className="mt-2 max-w-2xl text-xs leading-5 text-slate-500">
            在隔离 Worker 中真实运行 pandas 与 scikit-learn。预处理只在训练集拟合，并与朴素基线使用同一测试集比较。
          </p>
        </div>
        <Button onClick={train} disabled={running || !target || rows.length < 8} className="bg-cyan-300 text-slate-950 hover:bg-cyan-200">
          {running ? <Loader2 className="size-4 animate-spin" /> : result ? <RotateCcw className="size-4" /> : <Play className="size-4 fill-current" />}
          {running ? "训练中" : result ? "重新训练" : "开始真实训练"}
        </Button>
      </div>

      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between text-xs">
          <span className="text-slate-400">{status}</span><span className="font-mono text-cyan-300">{progress}%</span>
        </div>
        <Progress value={progress} className="h-1.5" />
      </div>

      {error ? <div className="mt-4 flex gap-2 border border-rose-400/20 bg-rose-400/5 p-3 text-sm text-rose-200"><CircleAlert className="mt-0.5 size-4 shrink-0" />{error}</div> : null}

      {result ? (
        <div className="mt-5 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="最佳模型" value={result.best.name} />
            <Metric label={String(primaryMetric?.[0] ?? "指标")} value={formatMetric(Number(primaryMetric?.[1]))} />
            <Metric label="训练 / 测试" value={`${result.trainRows} / ${result.testRows}`} />
            <Metric label="展开后特征" value={String(result.featureCount)} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="border border-white/8">
              <div className="border-b border-white/8 px-3 py-2 text-xs text-slate-500">模型对比</div>
              <div className="divide-y divide-white/8">
                {[result.baseline, ...result.candidates].map((candidate) => (
                  <div key={candidate.name} className="flex items-center justify-between gap-4 px-3 py-2.5 text-xs">
                    <span className="text-slate-300">{candidate.name}</span>
                    <span className="font-mono text-slate-400">{metricsText(candidate.metrics)}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="border border-white/8">
              <div className="border-b border-white/8 px-3 py-2 text-xs text-slate-500">模型行为 · Top 特征</div>
              <div className="divide-y divide-white/8">
                {result.topFeatures.length ? result.topFeatures.slice(0, 6).map((feature) => (
                  <div key={feature.name} className="px-3 py-2.5">
                    <div className="flex justify-between gap-3 text-xs"><span className="truncate text-slate-300">{feature.name}</span><span className="font-mono text-slate-500">{feature.importance.toFixed(3)}</span></div>
                    <div className="mt-1 h-1 bg-white/5"><div className="h-full bg-cyan-400/70" style={{ width: `${Math.min(100, Math.abs(feature.importance) * 100)}%` }} /></div>
                  </div>
                )) : <div className="p-3 text-xs text-slate-600">当前模型没有可提取的重要性。</div>}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 text-[11px] text-slate-500">
            <span className="flex items-center gap-1 border border-emerald-400/15 bg-emerald-400/5 px-2 py-1 text-emerald-300"><CheckCircle2 className="size-3" />{result.split}</span>
            <span className="border border-white/8 px-2 py-1">Python {result.versions.python}</span>
            <span className="border border-white/8 px-2 py-1">scikit-learn {result.versions.sklearn}</span>
            <span className="border border-white/8 px-2 py-1">seed=42</span>
          </div>
          {result.warnings.map((warning) => <div key={warning} className="text-xs leading-5 text-amber-300/80">注意：{warning}</div>)}
        </div>
      ) : null}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="border border-white/8 bg-white/3 p-3"><div className="text-[11px] text-slate-600">{label}</div><div className="mt-2 truncate font-mono text-sm text-slate-200">{value}</div></div>
}

function formatMetric(value: number) { return Number.isFinite(value) ? value.toFixed(3) : "—" }
function metricsText(metrics: Record<string, number>) {
  return Object.entries(metrics).slice(0, 2).map(([key, value]) => `${key} ${formatMetric(value)}`).join(" · ")
}
