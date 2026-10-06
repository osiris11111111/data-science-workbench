"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { CheckCircle2, CircleAlert, Cpu, Loader2, Play, RotateCcw } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import type { ModelChoice, ModelTask } from "@/lib/model-catalog"

type Cell = string | number | boolean | null
type DataRow = Record<string, Cell>
type RegressionDiagnostics = {
  kind: "regression"
  actual: number[]
  predicted: number[]
  residuals: number[]
  residualMean: number
  residualStd: number
}
type ClassificationDiagnostics = {
  kind: "classification"
  labels: string[]
  matrix: number[][]
  actual: string[]
  predicted: string[]
}
export type TrainResult = {
  task: ModelTask
  target: string
  selectionMode: "auto" | "manual"
  rowsUsed: number
  trainRows: number
  testRows: number
  featureCount: number
  split: string
  baseline: { name: string; metrics: Record<string, number> }
  best: { name: string; metrics: Record<string, number> }
  candidates: Array<{ name: string; metrics: Record<string, number> }>
  topFeatures: Array<{ name: string; importance: number }>
  diagnostics: RegressionDiagnostics | ClassificationDiagnostics
  versions: Record<string, string>
  warnings: string[]
}
export type ExperimentRecord = {
  id: string
  createdAt: string
  datasetName: string
  task: ModelTask
  target: string
  modelName: string
  selectionMode: "auto" | "manual"
  split: string
  metrics: Record<string, number>
  baselineMetrics: Record<string, number>
  rowsUsed: number
  featureCount: number
}

type WorkerMessage =
  | { type: "progress"; progress: number; message: string }
  | { type: "result"; result: TrainResult }
  | { type: "error"; error: string }

type Props = {
  rows: DataRow[]
  target: string
  task: ModelTask
  modelChoice: ModelChoice
  datasetName: string
  onExperiment: (experiment: ExperimentRecord) => void
}

export function PythonModelLab({ rows, target, task, modelChoice, datasetName, onExperiment }: Props) {
  const workerRef = useRef<Worker | null>(null)
  const [progress, setProgress] = useState(0)
  const [status, setStatus] = useState("等待训练")
  const [result, setResult] = useState<TrainResult | null>(null)
  const [error, setError] = useState("")
  const [running, setRunning] = useState(false)

  useEffect(() => () => workerRef.current?.terminate(), [])
  useEffect(() => {
    workerRef.current?.terminate()
    workerRef.current = null
    setResult(null)
    setError("")
    setProgress(0)
    setStatus("等待训练")
    setRunning(false)
  }, [task, target, modelChoice])

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
        onExperiment({
          id: crypto.randomUUID(),
          createdAt: new Date().toISOString(),
          datasetName,
          task: message.result.task,
          target: message.result.target,
          modelName: message.result.best.name,
          selectionMode: message.result.selectionMode,
          split: message.result.split,
          metrics: message.result.best.metrics,
          baselineMetrics: message.result.baseline.metrics,
          rowsUsed: message.result.rowsUsed,
          featureCount: message.result.featureCount,
        })
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

    worker.postMessage({ type: "train", payload: { rows: rows.slice(0, 5000), originalRows: rows.length, target, task, modelChoice, seed: 42 } })
  }

  const primaryMetric = result
    ? task === "classification"
      ? ["F1", result.best.metrics.f1_weighted]
      : ["MAE", result.best.metrics.mae]
    : null

  return (
    <section className="mt-4 rounded-lg border border-slate-200 bg-white p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Cpu className="size-4 text-blue-600" />
            <h3 className="text-sm font-semibold text-slate-800">Python 训练与评估</h3>
            <Badge variant="outline" className="border-slate-200 bg-slate-50 text-[10px] font-normal text-slate-500">Pyodide Worker</Badge>
          </div>
          <p className="mt-2 max-w-2xl text-xs leading-5 text-slate-500">
            在隔离 Worker 中运行 pandas 与 scikit-learn。预处理只在训练集拟合，评估与朴素基线使用相同测试集。
          </p>
        </div>
        <Button onClick={train} disabled={running || !target || rows.length < 8}>
          {running ? <Loader2 className="size-4 animate-spin" /> : result ? <RotateCcw className="size-4" /> : <Play className="size-4 fill-current" />}
          {running ? "训练中" : result ? "重新训练" : "开始真实训练"}
        </Button>
      </div>

      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between text-xs">
          <span className="text-slate-500">{status}</span><span className="tabular-nums text-blue-600">{progress}%</span>
        </div>
        <Progress value={progress} className="h-1.5" />
      </div>

      {error ? <div className="mt-4 flex gap-2 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700"><CircleAlert className="mt-0.5 size-4 shrink-0" />{error}</div> : null}

      {result ? (
        <div className="mt-5 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label={result.selectionMode === "manual" ? "指定模型" : "最佳模型"} value={result.best.name} />
            <Metric label={String(primaryMetric?.[0] ?? "指标")} value={formatMetric(Number(primaryMetric?.[1]))} />
            <Metric label="训练 / 测试" value={result.trainRows + " / " + result.testRows} />
            <Metric label="展开后特征" value={String(result.featureCount)} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="overflow-hidden rounded-md border border-slate-200">
              <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-600">模型对比</div>
              <div className="divide-y divide-slate-100">
                {[result.baseline, ...result.candidates].map((candidate) => (
                  <div key={candidate.name} className="flex items-center justify-between gap-4 px-3 py-2.5 text-xs">
                    <span className="text-slate-700">{candidate.name}</span>
                    <span className="tabular-nums text-slate-500">{metricsText(candidate.metrics)}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="overflow-hidden rounded-md border border-slate-200">
              <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-600">模型行为 · Top 特征</div>
              <div className="divide-y divide-slate-100">
                {result.topFeatures.length ? result.topFeatures.slice(0, 6).map((feature) => (
                  <div key={feature.name} className="px-3 py-2.5">
                    <div className="flex justify-between gap-3 text-xs"><span className="truncate text-slate-700">{feature.name}</span><span className="tabular-nums text-slate-500">{feature.importance.toFixed(3)}</span></div>
                    <div className="mt-1 h-1 bg-slate-100"><div className="h-full bg-blue-500" style={{ width: String(Math.min(100, Math.abs(feature.importance) * 100)) + "%" }} /></div>
                  </div>
                )) : <div className="p-3 text-xs text-slate-400">当前模型没有可提取的重要性。</div>}
              </div>
            </div>
          </div>

          <EvaluationCenter result={result} />

          <div className="flex flex-wrap gap-2 text-[11px] text-slate-500">
            <span className="flex items-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-emerald-700"><CheckCircle2 className="size-3" />{result.split}</span>
            <span className="rounded border border-slate-200 bg-slate-50 px-2 py-1">Python {result.versions.python}</span>
            <span className="rounded border border-slate-200 bg-slate-50 px-2 py-1">scikit-learn {result.versions.sklearn}</span>
            <span className="rounded border border-slate-200 bg-slate-50 px-2 py-1">seed=42</span>
          </div>
          {result.warnings.map((warning) => <div key={warning} className="text-xs leading-5 text-amber-700">注意：{warning}</div>)}
        </div>
      ) : null}
    </section>
  )
}

function EvaluationCenter({ result }: { result: TrainResult }) {
  return (
    <section className="overflow-hidden rounded-md border border-slate-200">
      <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-2">
        <div><p className="text-xs font-semibold text-slate-700">模型评估中心</p><p className="mt-0.5 text-[11px] text-slate-400">{result.task === "classification" ? "混淆矩阵与分类错误" : result.task === "forecast" ? "预测拟合与留后残差" : "预测拟合与残差诊断"}</p></div>
        <span className="text-[10px] text-slate-400">测试集</span>
      </div>
      {result.diagnostics.kind === "classification"
        ? <ClassificationEvaluation diagnostics={result.diagnostics} />
        : <RegressionEvaluation diagnostics={result.diagnostics} />}
    </section>
  )
}

function RegressionEvaluation({ diagnostics }: { diagnostics: RegressionDiagnostics }) {
  const points = useMemo(() => diagnostics.actual.map((actual, index) => ({ actual, predicted: diagnostics.predicted[index], residual: diagnostics.residuals[index] })).filter((point) => [point.actual, point.predicted, point.residual].every(Number.isFinite)), [diagnostics])
  const values = points.flatMap((point) => [point.actual, point.predicted])
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const maxAbs = Math.max(...points.map((point) => Math.abs(point.residual)), 0)
  return (
    <div className="grid gap-0 lg:grid-cols-[1.2fr_.8fr]">
      <div className="border-b border-slate-200 p-4 lg:border-r lg:border-b-0">
        <p className="mb-3 text-xs font-medium text-slate-600">真实值 vs 预测值</p>
        <svg viewBox="0 0 420 220" className="h-56 w-full" role="img" aria-label="真实值与预测值散点图">
          <rect x="38" y="12" width="366" height="180" fill="#fbfcfd" stroke="#e5e7eb" />
          <line x1="48" y1="182" x2="394" y2="22" stroke="#cbd5e1" strokeDasharray="5 4" />
          {points.slice(0, 150).map((point, index) => {
            const x = 48 + ((point.actual - min) / span) * 346
            const y = 182 - ((point.predicted - min) / span) * 160
            return <circle key={index} cx={x} cy={y} r="3.2" fill="#2563eb" fillOpacity=".7" />
          })}
          <text x="211" y="214" textAnchor="middle" fontSize="11" fill="#64748b">真实值</text>
          <text x="13" y="105" textAnchor="middle" fontSize="11" fill="#64748b" transform="rotate(-90 13 105)">预测值</text>
        </svg>
      </div>
      <div className="p-4">
        <p className="text-xs font-medium text-slate-600">残差摘要</p>
        <div className="mt-3 grid grid-cols-3 gap-2 lg:grid-cols-1">
          <Metric label="平均残差" value={formatMetric(diagnostics.residualMean)} />
          <Metric label="残差标准差" value={formatMetric(diagnostics.residualStd)} />
          <Metric label="最大绝对残差" value={formatMetric(maxAbs)} />
        </div>
        <p className="mt-3 text-[11px] leading-5 text-slate-500">点越贴近虚线，预测越接近真实值。平均残差接近 0 不代表所有分组都没有系统偏差。</p>
      </div>
    </div>
  )
}

function ClassificationEvaluation({ diagnostics }: { diagnostics: ClassificationDiagnostics }) {
  const total = diagnostics.matrix.flat().reduce((sum, value) => sum + value, 0)
  const correct = diagnostics.matrix.reduce((sum, row, index) => sum + (row[index] ?? 0), 0)
  const maxCell = Math.max(...diagnostics.matrix.flat(), 1)
  return (
    <div className="grid gap-0 lg:grid-cols-[1.25fr_.75fr]">
      <div className="overflow-x-auto border-b border-slate-200 p-4 lg:border-r lg:border-b-0">
        <p className="mb-3 text-xs font-medium text-slate-600">混淆矩阵 · 行为真实类别，列为预测类别</p>
        <table className="w-full min-w-[420px] border-collapse text-center text-xs">
          <thead><tr><th className="p-2 text-left font-medium text-slate-400">真实 \\ 预测</th>{diagnostics.labels.map((label) => <th key={label} className="p-2 font-medium text-slate-500">{label}</th>)}</tr></thead>
          <tbody>{diagnostics.labels.map((label, rowIndex) => <tr key={label}><th className="border-t border-slate-100 p-2 text-left font-medium text-slate-600">{label}</th>{diagnostics.matrix[rowIndex].map((value, columnIndex) => <td key={columnIndex} className="border border-white p-2 font-medium text-slate-700" style={{ backgroundColor: "rgba(37,99,235," + (0.06 + (value / maxCell) * 0.3) + ")" }}>{value}</td>)}</tr>)}</tbody>
        </table>
      </div>
      <div className="p-4">
        <p className="text-xs font-medium text-slate-600">分类摘要</p>
        <div className="mt-3 space-y-2">
          <Metric label="测试样本" value={String(total)} />
          <Metric label="正确预测" value={String(correct)} />
          <Metric label="错误预测" value={String(Math.max(0, total - correct))} />
        </div>
        <p className="mt-3 text-[11px] leading-5 text-slate-500">对角线是正确预测。高亮的非对角单元格表示最常混淆的类别。</p>
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-md border border-slate-200 bg-slate-50 p-3"><div className="text-[11px] text-slate-500">{label}</div><div className="mt-2 truncate text-sm font-semibold text-slate-800">{value}</div></div>
}

function formatMetric(value: number) { return Number.isFinite(value) ? value.toFixed(3) : "—" }
function metricsText(metrics: Record<string, number>) {
  return Object.entries(metrics).slice(0, 2).map(([key, value]) => key + " " + formatMetric(value)).join(" · ")
}
