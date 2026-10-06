"use client"

import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from "react"
import * as XLSX from "xlsx"
import { AreaChart, ArrowDownToLine, BarChart3, BrainCircuit, Check, ChevronRight, CircleAlert, Database, FileSpreadsheet, FlaskConical, LineChart as LineChartIcon, ListChecks, Loader2, Play, RotateCcw, ShieldCheck, Sparkles, Trash2, Undo2, UploadCloud, WandSparkles } from "lucide-react"
import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Progress } from "@/components/ui/progress"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { LlmInsightPanel } from "@/components/llm-insight-panel"
import { PythonModelLab, type ExperimentRecord } from "@/components/python-model-lab"
import { MODEL_OPTIONS, modelLabel, type ModelChoice, type ModelTask } from "@/lib/model-catalog"

type Cell = string | number | boolean | null
type DataRow = Record<string, Cell>
type ColumnKind = "number" | "date" | "category" | "boolean"
type ColumnProfile = { name: string; kind: ColumnKind; missing: number; unique: number; min?: number; max?: number; mean?: number }
type Profile = { rows: number; columns: number; missingCells: number; duplicateRows: number; numericColumns: number; columnProfiles: ColumnProfile[] }
type AnalysisResult = { title: string; summary: string; bullets: string[]; method: string; confidence: string }
type CleaningType = "drop_duplicates" | "trim_text" | "drop_missing" | "fill_missing" | "clip_outliers"
type CleaningOperation = { id: string; type: CleaningType; label: string; column?: string; strategy?: "mean" | "median" | "mode" }

const demoRows: DataRow[] = [
  { month: "2026-01", region: "North", channel: "Enterprise", revenue: 184000, orders: 212, churn_rate: 0.041, satisfaction: 8.6 },
  { month: "2026-01", region: "South", channel: "Self-serve", revenue: 118000, orders: 294, churn_rate: 0.064, satisfaction: 7.9 },
  { month: "2026-02", region: "North", channel: "Enterprise", revenue: 197000, orders: 226, churn_rate: 0.038, satisfaction: 8.8 },
  { month: "2026-02", region: "West", channel: "Partner", revenue: 142000, orders: 248, churn_rate: 0.057, satisfaction: 8.1 },
  { month: "2026-03", region: "South", channel: "Self-serve", revenue: 126000, orders: 321, churn_rate: 0.061, satisfaction: 8.0 },
  { month: "2026-03", region: "West", channel: "Partner", revenue: 151000, orders: 264, churn_rate: 0.052, satisfaction: 8.3 },
  { month: "2026-04", region: "North", channel: "Enterprise", revenue: 221000, orders: 239, churn_rate: 0.033, satisfaction: 9.0 },
  { month: "2026-04", region: "South", channel: "Self-serve", revenue: 132000, orders: 337, churn_rate: 0.058, satisfaction: 8.1 },
  { month: "2026-05", region: "West", channel: "Partner", revenue: 167000, orders: 283, churn_rate: 0.046, satisfaction: 8.5 },
  { month: "2026-05", region: "North", channel: "Enterprise", revenue: 236000, orders: 251, churn_rate: 0.031, satisfaction: 9.1 },
  { month: "2026-06", region: "South", channel: "Self-serve", revenue: 144000, orders: 358, churn_rate: null, satisfaction: 8.2 },
  { month: "2026-06", region: "West", channel: "Partner", revenue: 179000, orders: 301, churn_rate: 0.043, satisfaction: 8.7 },
]

function coerceCell(value: unknown): Cell {
  if (value === null || value === undefined || value === "") return null
  if (typeof value === "number" || typeof value === "boolean") return value
  const text = String(value).trim()
  if (!text) return null
  if (/^(true|false)$/i.test(text)) return text.toLowerCase() === "true"
  const numeric = Number(text.replace(/,/g, "").replace(/%$/, ""))
  if (Number.isFinite(numeric) && /^[-+]?\d[\d,]*(\.\d+)?%?$/.test(text)) return text.endsWith("%") ? numeric / 100 : numeric
  return text
}

function parseCsv(text: string): DataRow[] {
  const records: string[][] = []
  let row: string[] = [], field = "", quoted = false
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i], next = text[i + 1]
    if (char === '"' && quoted && next === '"') { field += '"'; i += 1 }
    else if (char === '"') quoted = !quoted
    else if (char === "," && !quoted) { row.push(field); field = "" }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i += 1
      row.push(field); if (row.some((item) => item.trim() !== "")) records.push(row); row = []; field = ""
    } else field += char
  }
  row.push(field); if (row.some((item) => item.trim() !== "")) records.push(row)
  if (records.length < 2) return []
  const headers = records[0].map((header, index) => header.trim() || `column_${index + 1}`)
  return records.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, coerceCell(values[index] ?? null)])))
}

function isMissing(value: Cell | undefined) { return value === null || value === undefined || value === "" }

function inferKind(values: Cell[]): ColumnKind {
  const present = values.filter((value) => !isMissing(value))
  if (present.length && present.every((value) => typeof value === "number")) return "number"
  if (present.length && present.every((value) => typeof value === "boolean")) return "boolean"
  const dateLike = present.filter((value) => typeof value === "string" && !Number.isNaN(Date.parse(value))).length
  if (present.length && dateLike / present.length > 0.8) return "date"
  return "category"
}

function buildProfile(rows: DataRow[]): Profile {
  const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row))))
  const columnProfiles = columns.map((name) => {
    const values = rows.map((row) => row[name]), kind = inferKind(values)
    const numbers = values.filter((value): value is number => typeof value === "number")
    return { name, kind, missing: values.filter(isMissing).length, unique: new Set(values.filter((value) => !isMissing(value)).map(String)).size, min: kind === "number" && numbers.length ? Math.min(...numbers) : undefined, max: kind === "number" && numbers.length ? Math.max(...numbers) : undefined, mean: kind === "number" && numbers.length ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : undefined }
  })
  return { rows: rows.length, columns: columns.length, missingCells: columnProfiles.reduce((sum, column) => sum + column.missing, 0), duplicateRows: rows.length - new Set(rows.map((row) => JSON.stringify(row))).size, numericColumns: columnProfiles.filter((column) => column.kind === "number").length, columnProfiles }
}

function applyCleaningOperations(source: DataRow[], operations: CleaningOperation[]) {
  return operations.reduce((current, operation) => {
    if (operation.type === "drop_duplicates") {
      const seen = new Set<string>()
      return current.filter((row) => { const key = JSON.stringify(row); if (seen.has(key)) return false; seen.add(key); return true })
    }
    if (operation.type === "trim_text") return current.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, typeof value === "string" ? value.trim() : value])))
    if (!operation.column) return current
    if (operation.type === "drop_missing") return current.filter((row) => !isMissing(row[operation.column as string]))
    if (operation.type === "fill_missing") {
      const present = current.map((row) => row[operation.column as string]).filter((value) => !isMissing(value))
      let replacement: Cell = null
      if (operation.strategy === "mode") {
        const counts = new Map<string, { value: Cell; count: number }>()
        present.forEach((value) => { const key = String(value); counts.set(key, { value, count: (counts.get(key)?.count ?? 0) + 1 }) })
        replacement = [...counts.values()].sort((a, b) => b.count - a.count)[0]?.value ?? null
      } else {
        const values = present.filter((value): value is number => typeof value === "number").sort((a, b) => a - b)
        if (values.length) replacement = operation.strategy === "mean" ? values.reduce((sum, value) => sum + value, 0) / values.length : values.length % 2 ? values[Math.floor(values.length / 2)] : (values[values.length / 2 - 1] + values[values.length / 2]) / 2
        else {
          const counts = new Map<string, { value: Cell; count: number }>()
          present.forEach((value) => { const key = String(value); counts.set(key, { value, count: (counts.get(key)?.count ?? 0) + 1 }) })
          replacement = [...counts.values()].sort((a, b) => b.count - a.count)[0]?.value ?? null
        }
      }
      return current.map((row) => isMissing(row[operation.column as string]) ? { ...row, [operation.column as string]: replacement } : row)
    }
    const values = current.map((row) => row[operation.column as string]).filter((value): value is number => typeof value === "number").sort((a, b) => a - b)
    if (values.length < 4) return current
    const quantile = (p: number) => values[Math.min(values.length - 1, Math.max(0, Math.floor((values.length - 1) * p)))]
    const q1 = quantile(.25), q3 = quantile(.75), iqr = q3 - q1, lower = q1 - 1.5 * iqr, upper = q3 + 1.5 * iqr
    return current.map((row) => typeof row[operation.column as string] === "number" ? { ...row, [operation.column as string]: Math.min(upper, Math.max(lower, row[operation.column as string] as number)) } : row)
  }, source.map((row) => ({ ...row })))
}

function correlation(xs: number[], ys: number[]) {
  if (xs.length < 3 || xs.length !== ys.length) return 0
  const meanX = xs.reduce((a, b) => a + b, 0) / xs.length, meanY = ys.reduce((a, b) => a + b, 0) / ys.length
  const numerator = xs.reduce((sum, x, index) => sum + (x - meanX) * (ys[index] - meanY), 0)
  const denominator = Math.sqrt(xs.reduce((sum, x) => sum + (x - meanX) ** 2, 0) * ys.reduce((sum, y) => sum + (y - meanY) ** 2, 0))
  return denominator ? numerator / denominator : 0
}

function fmt(value: number | undefined, digits = 1) { return value === undefined || Number.isNaN(value) ? "—" : new Intl.NumberFormat("zh-CN", { maximumFractionDigits: digits }).format(value) }

function analyzeRows(rows: DataRow[], profile: Profile, prompt: string): AnalysisResult {
  const query = prompt.toLowerCase(), numeric = profile.columnProfiles.filter((column) => column.kind === "number"), dimensions = profile.columnProfiles.filter((column) => column.kind !== "number")
  if (/缺失|missing|null|质量|quality/.test(query)) {
    const ranked = [...profile.columnProfiles].sort((a, b) => b.missing - a.missing).filter((column) => column.missing > 0)
    return { title: "数据质量扫描", summary: ranked.length ? `发现 ${profile.missingCells} 个缺失单元格，集中在 ${ranked[0].name}。` : "未发现缺失值，基础完整性良好。", bullets: [...ranked.slice(0, 3).map((column) => `${column.name}: ${column.missing} 个缺失（${fmt((column.missing / Math.max(profile.rows, 1)) * 100)}%）`), `${profile.duplicateRows} 条重复记录`, "建议在建模前确认缺失机制，并保留清洗规则。"], method: "逐列空值计数 + 全行哈希去重", confidence: "确定性计算" }
  }
  if (/相关|correlation|关系/.test(query) && numeric.length >= 2) {
    let strongest = { a: numeric[0].name, b: numeric[1].name, value: 0 }
    for (let i = 0; i < numeric.length; i += 1) for (let j = i + 1; j < numeric.length; j += 1) {
      const pairs = rows.map((row) => [row[numeric[i].name], row[numeric[j].name]]).filter((pair): pair is [number, number] => pair.every((value) => typeof value === "number"))
      const value = correlation(pairs.map((pair) => pair[0]), pairs.map((pair) => pair[1]))
      if (Math.abs(value) > Math.abs(strongest.value)) strongest = { a: numeric[i].name, b: numeric[j].name, value }
    }
    return { title: "相关性分析", summary: `最强线性关系出现在 ${strongest.a} 与 ${strongest.b}，Pearson r = ${strongest.value.toFixed(3)}。`, bullets: [Math.abs(strongest.value) > 0.7 ? "线性关系较强，值得进一步检验。" : "线性关系有限，可能存在非线性或分组效应。", "相关性不代表因果关系。", `使用 ${profile.rows} 行数据，缺失配对已排除。`], method: "两两 Pearson 相关系数", confidence: "探索性结果" }
  }
  if (/趋势|trend|时间|month|date/.test(query)) {
    const dateColumn = profile.columnProfiles.find((column) => column.kind === "date") ?? dimensions.find((column) => /date|month|time|日期|月份/i.test(column.name)), metric = numeric[0]
    if (dateColumn && metric) {
      const grouped = new Map<string, number>()
      rows.forEach((row) => { const key = String(row[dateColumn.name] ?? "未知"), value = row[metric.name]; if (typeof value === "number") grouped.set(key, (grouped.get(key) ?? 0) + value) })
      const ordered = [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b)), first = ordered[0]?.[1] ?? 0, last = ordered.at(-1)?.[1] ?? 0, change = first ? ((last - first) / first) * 100 : 0
      return { title: "时间趋势", summary: `${metric.name} 从首期到末期变化 ${change >= 0 ? "+" : ""}${change.toFixed(1)}%。`, bullets: [`时间粒度：${dateColumn.name}`, `首期 ${fmt(first)}；末期 ${fmt(last)}`, "建议结合季节性和业务事件解释变化。"], method: `按 ${dateColumn.name} 汇总 ${metric.name}`, confidence: "描述性趋势" }
    }
  }
  if (/top|最高|分类|category|分组|region|channel/.test(query) && dimensions.length) {
    const dimension = dimensions.find((column) => column.kind === "category") ?? dimensions[0], counts = new Map<string, number>()
    rows.forEach((row) => { const key = String(row[dimension.name] ?? "缺失"); counts.set(key, (counts.get(key) ?? 0) + 1) })
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1])
    return { title: "分组分布", summary: `${dimension.name} 中占比最高的是 ${ranked[0]?.[0] ?? "—"}。`, bullets: ranked.slice(0, 3).map(([name, count]) => `${name}: ${count} 行（${fmt((count / Math.max(rows.length, 1)) * 100)}%）`), method: `按 ${dimension.name} 频数排序`, confidence: "确定性计算" }
  }
  if (/预测|模型|model|forecast|回归/.test(query)) return { title: "建模任务拆解", summary: `建议先以 ${numeric[0]?.name ?? profile.columnProfiles[0]?.name ?? "目标字段"} 为目标建立可解释基线，再与树模型比较。`, bullets: ["按时间或业务实体切分训练/验证集，避免泄漏。", "记录缺失填补、编码和缩放步骤。", "先看基线指标，再决定是否增加模型复杂度。"], method: "任务识别 + 验证设计检查表", confidence: "方案建议，尚未训练模型" }
  const missingRate = profile.rows * profile.columns ? (profile.missingCells / (profile.rows * profile.columns)) * 100 : 0
  return { title: "数据集概览", summary: `当前数据包含 ${profile.rows} 行、${profile.columns} 列，缺失率 ${missingRate.toFixed(1)}%。`, bullets: [`${profile.numericColumns} 个数值字段，可用于统计与建模。`, `${profile.duplicateRows} 条重复记录。`, numeric[0] ? `${numeric[0].name} 均值为 ${fmt(numeric[0].mean)}。` : "没有识别到数值字段。"], method: "字段类型推断 + 描述性统计", confidence: "确定性计算" }
}

function KindBadge({ kind }: { kind: ColumnKind }) {
  const labels: Record<ColumnKind, string> = { number: "数值", date: "日期", category: "类别", boolean: "布尔" }
  return <Badge variant="outline" className="border-slate-200 bg-slate-50 font-normal text-slate-600">{labels[kind]}</Badge>
}

function experimentMetric(experiment: ExperimentRecord) {
  const key = experiment.task === "classification" ? "f1_weighted" : "mae"
  return { key: experiment.task === "classification" ? "F1" : "MAE", value: experiment.metrics[key], baseline: experiment.baselineMetrics[key] }
}

function experimentImprovement(experiment: ExperimentRecord) {
  const metric = experimentMetric(experiment)
  if (!Number.isFinite(metric.value) || !Number.isFinite(metric.baseline) || metric.baseline === 0) return "—"
  const change = experiment.task === "classification" ? ((metric.value - metric.baseline) / Math.abs(metric.baseline)) * 100 : ((metric.baseline - metric.value) / Math.abs(metric.baseline)) * 100
  return (change >= 0 ? "+" : "") + change.toFixed(1) + "%"
}

export default function Home() {
  const [rawRows, setRawRows] = useState<DataRow[]>(demoRows), [datasetName, setDatasetName] = useState("SaaS 经营指标 · 示例"), [status, setStatus] = useState("示例数据已就绪"), [loading, setLoading] = useState(false)
  const [prompt, setPrompt] = useState("总结数据质量，并指出最值得关注的指标"), [result, setResult] = useState<AnalysisResult>(() => analyzeRows(demoRows, buildProfile(demoRows), "总结"))
  const [dimension, setDimension] = useState("month"), [measure, setMeasure] = useState("revenue"), [aggregation, setAggregation] = useState("sum"), [chartType, setChartType] = useState<"bar" | "line">("line")
  const [modelTask, setModelTask] = useState<ModelTask>("regression"), [modelChoice, setModelChoice] = useState<ModelChoice>("auto"), [target, setTarget] = useState("revenue"), [modelPlan, setModelPlan] = useState<AnalysisResult | null>(null)
  const [cleaningOperations, setCleaningOperations] = useState<CleaningOperation[]>([])
  const [cleaningType, setCleaningType] = useState<CleaningType>("fill_missing"), [cleaningColumn, setCleaningColumn] = useState("churn_rate"), [cleaningStrategy, setCleaningStrategy] = useState<"mean" | "median" | "mode">("median")
  const [experiments, setExperiments] = useState<ExperimentRecord[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const rows = useMemo(() => applyCleaningOperations(rawRows, cleaningOperations), [rawRows, cleaningOperations])
  const rawProfile = useMemo(() => buildProfile(rawRows), [rawRows])
  const profile = useMemo(() => buildProfile(rows), [rows]), columns = profile.columnProfiles.map((column) => column.name), dimensions = profile.columnProfiles.filter((column) => column.kind !== "number"), measures = profile.columnProfiles.filter((column) => column.kind === "number")

  useEffect(() => { if (!columns.includes(dimension)) setDimension(dimensions[0]?.name ?? columns[0] ?? ""); if (!columns.includes(measure)) setMeasure(measures[0]?.name ?? "__count"); if (!columns.includes(target)) setTarget(measures[0]?.name ?? columns[0] ?? ""); if (!columns.includes(cleaningColumn)) setCleaningColumn(columns[0] ?? "") }, [columns.join("|"), dimension, measure, target, cleaningColumn])
  useEffect(() => {
    try { setExperiments(JSON.parse(localStorage.getItem("lenslab-experiments-v1") ?? "[]") as ExperimentRecord[]) } catch { setExperiments([]) }
  }, [])

  const chartData = useMemo(() => {
    if (!dimension) return []
    const groups = new Map<string, number[]>()
    rows.forEach((row) => { const key = String(row[dimension] ?? "缺失"), value = measure === "__count" ? 1 : row[measure]; if (typeof value === "number") groups.set(key, [...(groups.get(key) ?? []), value]) })
    return [...groups.entries()].map(([name, values]) => ({ name, value: aggregation === "count" ? values.length : aggregation === "avg" ? values.reduce((a, b) => a + b, 0) / values.length : values.reduce((a, b) => a + b, 0) })).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 30)
  }, [rows, dimension, measure, aggregation])
  const qualityScore = Math.max(0, Math.round(100 - (profile.missingCells / Math.max(profile.rows * profile.columns, 1)) * 80 - (profile.duplicateRows / Math.max(profile.rows, 1)) * 20))

  function loadDemo() { setRawRows(demoRows); setCleaningOperations([]); setDatasetName("SaaS 经营指标 · 示例"); setStatus("示例数据已就绪"); setResult(analyzeRows(demoRows, buildProfile(demoRows), "总结")); return { rows: demoRows.length, columns: Object.keys(demoRows[0]).length } }
  async function readFile(file: File) {
    setLoading(true); setStatus(`正在读取 ${file.name}`)
    try {
      let parsed: DataRow[] = []
      if (/\.csv$/i.test(file.name)) parsed = parseCsv(await file.text())
      else if (/\.xlsx?$/i.test(file.name)) { const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" }), sheet = workbook.Sheets[workbook.SheetNames[0]], raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null, raw: true }); parsed = raw.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, coerceCell(value)]))) }
      else throw new Error("目前支持 CSV、XLSX 和 XLS")
      if (!parsed.length) throw new Error("文件中没有可读取的数据行")
      setRawRows(parsed); setCleaningOperations([]); setDatasetName(file.name); setStatus(`已在浏览器中加载 ${parsed.length} 行`); setResult(analyzeRows(parsed, buildProfile(parsed), "总结")); setModelPlan(null)
    } catch (error) { setStatus(error instanceof Error ? error.message : "文件读取失败") }
    finally { setLoading(false); if (inputRef.current) inputRef.current.value = "" }
  }
  function runAnalysis(nextPrompt = prompt) { const next = analyzeRows(rows, profile, nextPrompt); setPrompt(nextPrompt); setResult(next); return next }
  function changeModelTask(nextTask: ModelTask) { setModelTask(nextTask); setModelChoice("auto"); setModelPlan(null) }
  function changeModelChoice(nextChoice: ModelChoice) { setModelChoice(nextChoice); setModelPlan(null) }
  function addCleaningOperation() {
    const needsColumn = !["drop_duplicates", "trim_text"].includes(cleaningType)
    if (needsColumn && !cleaningColumn) return
    const columnLabel = cleaningColumn || "全部字段"
    const labels: Record<CleaningType, string> = {
      drop_duplicates: "删除完全重复的记录",
      trim_text: "清理全部文本字段首尾空格",
      drop_missing: `删除 ${columnLabel} 为空的记录`,
      fill_missing: `用${cleaningStrategy === "mean" ? "均值" : cleaningStrategy === "mode" ? "众数" : "中位数"}填补 ${columnLabel}`,
      clip_outliers: `按 IQR 范围缩尾 ${columnLabel}`,
    }
    setCleaningOperations((current) => [...current, { id: crypto.randomUUID(), type: cleaningType, label: labels[cleaningType], column: needsColumn ? cleaningColumn : undefined, strategy: cleaningType === "fill_missing" ? cleaningStrategy : undefined }])
    setModelPlan(null)
  }
  function recordExperiment(experiment: ExperimentRecord) {
    setExperiments((current) => {
      const next = [experiment, ...current].slice(0, 30)
      try { localStorage.setItem("lenslab-experiments-v1", JSON.stringify(next)) } catch { /* Browser storage can be unavailable in private contexts. */ }
      return next
    })
  }
  function clearExperiments() { setExperiments([]); try { localStorage.removeItem("lenslab-experiments-v1") } catch { /* Keep the in-memory reset. */ } }
  function createModelPlan() {
    const targetProfile = profile.columnProfiles.find((column) => column.name === target), taskLabel = modelTask === "classification" ? "分类" : modelTask === "forecast" ? "时间序列预测" : "回归"
    const selectedLabel = modelLabel(modelTask, modelChoice)
    setModelPlan({ title: `${taskLabel}验证方案`, summary: `目标字段为 ${target || "未选择"}；训练策略为“${selectedLabel}”，并与相同切分下的朴素基线比较。`, bullets: [modelTask === "forecast" ? "按时间顺序留后切分，禁止随机打乱。" : "使用固定随机种子的独立测试集，预处理仅在训练集拟合。", targetProfile?.missing ? `目标字段有 ${targetProfile.missing} 个缺失值，训练前将排除目标缺失行。` : "目标字段未发现缺失值。", modelTask === "classification" ? "主指标使用加权 F1，并同时报告准确率与平衡准确率。" : "主指标使用 MAE，并同时报告 RMSE 与 R²。"], method: `任务、目标字段、${selectedLabel}与数据质量联合检查`, confidence: "训练前方案，尚未拟合模型" })
  }
  function exportReport() { const payload = { generatedAt: new Date().toISOString(), dataset: datasetName, profile, cleaning: cleaningOperations, analysis: result, chart: { dimension, measure, aggregation, data: chartData }, modeling: { task: modelTask, target, model: modelChoice, modelLabel: modelLabel(modelTask, modelChoice), plan: modelPlan, experiments }, note: "All calculations were executed locally in the browser." }, url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" })), anchor = document.createElement("a"); anchor.href = url; anchor.download = `${datasetName.replace(/[^\w\u4e00-\u9fa5]+/g, "-")}-analysis.json`; anchor.click(); URL.revokeObjectURL(url) }

  const webMcpRef = useRef({ loadDemo, runAnalysis, setDimension, setMeasure, setAggregation }); webMcpRef.current = { loadDemo, runAnalysis, setDimension, setMeasure, setAggregation }
  useEffect(() => {
    type Tool = { name: string; description: string; inputSchema: object; execute: (input: Record<string, string>) => unknown }; type ModelContext = { registerTool: (tool: Tool) => void; unregisterTool?: (name: string) => void }
    const context = (document as Document & { modelContext?: ModelContext }).modelContext; if (!context) return
    const names = ["lenslab_load_demo", "lenslab_analyze_dataset", "lenslab_configure_chart"]
    context.registerTool({ name: names[0], description: "Load the built-in SaaS metrics demo dataset into LensLab.", inputSchema: { type: "object", properties: {} }, execute: () => webMcpRef.current.loadDemo() })
    context.registerTool({ name: names[1], description: "Run deterministic local analysis over the current dataset.", inputSchema: { type: "object", properties: { prompt: { type: "string" } }, required: ["prompt"] }, execute: (input) => webMcpRef.current.runAnalysis(input.prompt) })
    context.registerTool({ name: names[2], description: "Configure the visible chart using current dataset columns.", inputSchema: { type: "object", properties: { dimension: { type: "string" }, measure: { type: "string" }, aggregation: { type: "string", enum: ["sum", "avg", "count"] } }, required: ["dimension", "measure", "aggregation"] }, execute: (input) => { webMcpRef.current.setDimension(input.dimension); webMcpRef.current.setMeasure(input.measure); webMcpRef.current.setAggregation(input.aggregation); return { status: "configured", ...input } } })
    return () => names.forEach((name) => context.unregisterTool?.(name))
  }, [])

  const chart = (height: string) => (
    <ChartContainer config={{ value: { label: measure, color: "#2563eb" } }} className={[height, "w-full aspect-auto"].join(" ")}>
      {chartType === "bar" ? (
        <BarChart data={chartData}>
          <CartesianGrid vertical={false} stroke="#e5e7eb" />
          <XAxis dataKey="name" tickLine={false} axisLine={false} minTickGap={24} />
          <YAxis tickLine={false} axisLine={false} width={58} tickFormatter={(value) => fmt(value, 0)} />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Bar dataKey="value" fill="var(--color-value)" radius={[3, 3, 0, 0]} />
        </BarChart>
      ) : (
        <LineChart data={chartData}>
          <CartesianGrid vertical={false} stroke="#e5e7eb" />
          <XAxis dataKey="name" tickLine={false} axisLine={false} minTickGap={24} />
          <YAxis tickLine={false} axisLine={false} width={58} tickFormatter={(value) => fmt(value, 0)} />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Line dataKey="value" type="monotone" stroke="var(--color-value)" strokeWidth={2.25} dot={{ r: 2.5 }} />
        </LineChart>
      )}
    </ChartContainer>
  )

  return (
    <main className="workbench-shell">
      <header className="app-bar">
        <div className="flex min-w-0 items-center gap-3">
          <div className="app-mark"><AreaChart className="size-4" /></div>
          <div className="min-w-0">
            <div className="flex items-baseline gap-2">
              <span className="font-semibold tracking-tight text-slate-900">LensLab</span>
              <span className="hidden text-xs text-slate-400 sm:inline">数据分析工作台</span>
            </div>
          </div>
          <span className="app-divider hidden sm:block" />
          <div className="hidden min-w-0 items-center gap-2 text-sm text-slate-600 md:flex">
            <FileSpreadsheet className="size-4 shrink-0 text-slate-400" />
            <span className="truncate">{datasetName}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="hidden items-center gap-2 text-xs text-slate-500 lg:flex"><span className="size-1.5 rounded-full bg-emerald-500" />本地数据</div>
          <Button onClick={exportReport} variant="outline" size="sm" className="bg-white text-slate-700"><ArrowDownToLine className="size-4" />导出</Button>
        </div>
      </header>

      <div className="workbench-grid">
        <aside className="pane pane-left">
          <div className="pane-heading">
            <div><p className="pane-title">数据</p><p className="pane-caption">{profile.rows} 行 · {profile.columns} 个字段</p></div>
            <Database className="size-4 text-slate-400" />
          </div>
          <div className="pane-section">
            <div
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event: DragEvent<HTMLDivElement>) => { event.preventDefault(); const file = event.dataTransfer.files?.[0]; if (file) void readFile(file) }}
              className="upload-zone"
            >
              {loading ? <Loader2 className="size-4 animate-spin text-blue-600" /> : <UploadCloud className="size-4 text-slate-500" />}
              <div className="min-w-0 flex-1 text-left"><p className="truncate text-sm font-medium text-slate-700">导入 CSV / Excel</p><p className="text-xs text-slate-400">拖放或从本地选择</p></div>
              <Input ref={inputRef} type="file" accept=".csv,.xlsx,.xls" onChange={(event: ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if (file) void readFile(file) }} className="hidden" />
              <Button size="sm" variant="ghost" className="h-8 px-2 text-blue-600" onClick={() => inputRef.current?.click()}>浏览</Button>
            </div>
            <button onClick={loadDemo} className="dataset-row">
              <span className="grid size-8 shrink-0 place-items-center rounded-md bg-blue-50 text-blue-600"><FileSpreadsheet className="size-4" /></span>
              <span className="min-w-0 flex-1 text-left"><span className="block truncate text-sm font-medium text-slate-800">{datasetName}</span><span className="block truncate text-xs text-slate-400">{status}</span></span>
              <ChevronRight className="size-4 shrink-0 text-slate-300" />
            </button>
          </div>
          <div className="pane-heading pane-heading-sub">
            <div><p className="pane-title">字段</p><p className="pane-caption">自动推断类型与质量</p></div>
          </div>
          <div className="field-list">
            {profile.columnProfiles.map((column) => (
              <div className="field-row" key={column.name}>
                <span className="field-icon">{column.kind === "number" ? "#" : column.kind === "date" ? "◷" : column.kind === "boolean" ? "✓" : "Aa"}</span>
                <span className="min-w-0 flex-1"><span className="block truncate text-sm text-slate-700">{column.name}</span><span className="block text-xs text-slate-400">{column.unique} 个唯一值{column.missing ? " · " + column.missing + " 缺失" : ""}</span></span>
              </div>
            ))}
          </div>
          <div className="pane-footer"><ShieldCheck className="size-3.5 text-emerald-600" />数据只在当前浏览器中解析</div>
        </aside>

        <section className="workspace">
          <div className="workspace-header">
            <div>
              <p className="text-base font-semibold text-slate-900">分析工作区</p>
              <p className="mt-0.5 text-sm text-slate-500">查看数据、构建图表并运行模型</p>
            </div>
            <div className="stat-strip">
              <div><span>记录</span><strong>{fmt(profile.rows, 0)}</strong></div>
              <div><span>字段</span><strong>{fmt(profile.columns, 0)}</strong></div>
              <div><span>缺失</span><strong className={profile.missingCells ? "text-amber-600" : ""}>{fmt(profile.missingCells, 0)}</strong></div>
              <div><span>质量</span><strong>{qualityScore}</strong><small>/100</small></div>
            </div>
          </div>

          <Tabs defaultValue="overview" className="workspace-tabs">
            <TabsList className="workspace-tab-list">
              <TabsTrigger value="overview">概览</TabsTrigger>
              <TabsTrigger value="data">数据表</TabsTrigger>
              <TabsTrigger value="prepare">数据准备</TabsTrigger>
              <TabsTrigger value="chart">图表</TabsTrigger>
              <TabsTrigger value="model">建模</TabsTrigger>
              <TabsTrigger value="experiments">实验</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="workspace-content">
              <div className="canvas-grid">
                <section className="surface">
                  <div className="surface-header">
                    <div><p className="surface-title">{measure === "__count" ? "记录数" : measure}，按 {dimension}</p><p className="surface-caption">{aggregation === "avg" ? "平均值" : aggregation === "count" ? "计数" : "总和"} · 实时聚合</p></div>
                    <div className="segmented-control">
                      <button onClick={() => setChartType("bar")} data-active={chartType === "bar"} aria-label="柱状图"><BarChart3 className="size-4" /></button>
                      <button onClick={() => setChartType("line")} data-active={chartType === "line"} aria-label="折线图"><LineChartIcon className="size-4" /></button>
                    </div>
                  </div>
                  <div className="p-4">{chart("h-[360px]")}</div>
                </section>
                <div className="space-y-4">
                  <section className="surface">
                    <div className="surface-header"><div><p className="surface-title">数据健康度</p><p className="surface-caption">完整性与重复值检查</p></div><span className="score">{qualityScore}</span></div>
                    <div className="space-y-3 p-4">
                      <Progress value={qualityScore} className="h-1.5" />
                      <div className="key-value"><span>缺失单元格</span><strong>{profile.missingCells}</strong></div>
                      <div className="key-value"><span>重复行</span><strong>{profile.duplicateRows}</strong></div>
                      <div className="key-value"><span>数值字段</span><strong>{profile.numericColumns}</strong></div>
                    </div>
                  </section>
                  <section className="surface">
                    <div className="surface-header"><div><p className="surface-title">分析状态</p><p className="surface-caption">当前工作区检查</p></div></div>
                    <div className="check-list">{["计算口径可追踪", "图表字段已绑定", "输出包含方法说明", "原始数据未离开浏览器"].map((item) => <div key={item}><Check className="size-4 text-emerald-600" />{item}</div>)}</div>
                  </section>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="data" className="workspace-content">
              <section className="surface overflow-hidden">
                <div className="surface-header"><div><p className="surface-title">字段画像</p><p className="surface-caption">类型、完整性和数值范围</p></div></div>
                <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>字段</TableHead><TableHead>类型</TableHead><TableHead className="text-right">缺失</TableHead><TableHead className="text-right">唯一值</TableHead><TableHead className="text-right">均值 / 范围</TableHead></TableRow></TableHeader><TableBody>{profile.columnProfiles.map((column) => <TableRow key={column.name}><TableCell className="font-medium text-slate-800">{column.name}</TableCell><TableCell><KindBadge kind={column.kind} /></TableCell><TableCell className="text-right tabular-nums text-slate-600">{column.missing}</TableCell><TableCell className="text-right tabular-nums text-slate-600">{column.unique}</TableCell><TableCell className="text-right tabular-nums text-slate-600">{column.kind === "number" ? fmt(column.mean) + " · " + fmt(column.min) + "–" + fmt(column.max) : "—"}</TableCell></TableRow>)}</TableBody></Table></div>
              </section>
              <section className="surface mt-4 overflow-hidden">
                <div className="surface-header"><div><p className="surface-title">数据预览</p><p className="surface-caption">前 8 行 · 最多 8 个字段</p></div></div>
                <div className="overflow-x-auto"><Table><TableHeader><TableRow>{columns.slice(0, 8).map((column) => <TableHead key={column} className="whitespace-nowrap">{column}</TableHead>)}</TableRow></TableHeader><TableBody>{rows.slice(0, 8).map((row, index) => <TableRow key={index}>{columns.slice(0, 8).map((column) => <TableCell key={column} className="whitespace-nowrap text-slate-600">{String(row[column] ?? "—")}</TableCell>)}</TableRow>)}</TableBody></Table></div>
              </section>
            </TabsContent>

            <TabsContent value="prepare" className="workspace-content">
              <div className="editor-grid">
                <aside className="inspector">
                  <div className="inspector-title"><ListChecks className="size-4" />添加清洗步骤</div>
                  <label className="control-label">操作<NativeSelect value={cleaningType} onChange={(e) => setCleaningType(e.target.value as CleaningType)}><NativeSelectOption value="fill_missing">填补缺失值</NativeSelectOption><NativeSelectOption value="drop_missing">删除缺失记录</NativeSelectOption><NativeSelectOption value="drop_duplicates">删除重复记录</NativeSelectOption><NativeSelectOption value="trim_text">清理文本空格</NativeSelectOption><NativeSelectOption value="clip_outliers">IQR 异常值缩尾</NativeSelectOption></NativeSelect></label>
                  {!["drop_duplicates", "trim_text"].includes(cleaningType) ? <label className="control-label">字段<NativeSelect value={cleaningColumn} onChange={(e) => setCleaningColumn(e.target.value)}>{rawProfile.columnProfiles.map((column) => <NativeSelectOption value={column.name} key={column.name}>{column.name}</NativeSelectOption>)}</NativeSelect></label> : null}
                  {cleaningType === "fill_missing" ? <label className="control-label">填补方法<NativeSelect value={cleaningStrategy} onChange={(e) => setCleaningStrategy(e.target.value as "mean" | "median" | "mode")}><NativeSelectOption value="median">中位数</NativeSelectOption><NativeSelectOption value="mean">均值</NativeSelectOption><NativeSelectOption value="mode">众数</NativeSelectOption></NativeSelect></label> : null}
                  <Button onClick={addCleaningOperation} className="mt-4 w-full"><Sparkles className="size-4" />应用步骤</Button>
                  <p className="inspector-note">每一步都从原始数据重新计算，可以撤销，不会覆盖上传文件。</p>
                </aside>
                <section className="surface overflow-hidden">
                  <div className="surface-header">
                    <div><p className="surface-title">清洗流水线</p><p className="surface-caption">按顺序执行 · 保留完整操作记录</p></div>
                    <div className="flex gap-2"><Button size="sm" variant="outline" disabled={!cleaningOperations.length} onClick={() => setCleaningOperations((current) => current.slice(0, -1))}><Undo2 className="size-4" />撤销</Button><Button size="sm" variant="ghost" disabled={!cleaningOperations.length} onClick={() => setCleaningOperations([])}><RotateCcw className="size-4" />重置</Button></div>
                  </div>
                  <div className="cleaning-summary">
                    <div><span>原始记录</span><strong>{rawProfile.rows}</strong></div>
                    <ChevronRight className="size-4 text-slate-300" />
                    <div><span>当前记录</span><strong>{profile.rows}</strong></div>
                    <div><span>缺失单元格</span><strong>{rawProfile.missingCells} → {profile.missingCells}</strong></div>
                    <div><span>步骤</span><strong>{cleaningOperations.length}</strong></div>
                  </div>
                  {cleaningOperations.length ? <div className="divide-y divide-slate-100">{cleaningOperations.map((operation, index) => <div key={operation.id} className="cleaning-step"><span className="cleaning-index">{String(index + 1).padStart(2, "0")}</span><div className="min-w-0 flex-1"><p className="text-sm font-medium text-slate-700">{operation.label}</p><p className="mt-1 text-xs text-slate-400">{operation.type}{operation.column ? " · " + operation.column : ""}</p></div><button onClick={() => setCleaningOperations((current) => current.filter((item) => item.id !== operation.id))} className="icon-button" aria-label={"删除步骤 " + operation.label}><Trash2 className="size-4" /></button></div>)}</div> : <div className="grid min-h-[300px] place-items-center text-center"><div><ListChecks className="mx-auto size-8 text-slate-300" /><p className="mt-3 text-sm font-medium text-slate-600">还没有清洗步骤</p><p className="mt-1 text-xs text-slate-400">从左侧添加操作，结果会即时更新。</p></div></div>}
                </section>
              </div>
            </TabsContent>

            <TabsContent value="chart" className="workspace-content">
              <div className="editor-grid">
                <aside className="inspector">
                  <div className="inspector-title"><BarChart3 className="size-4" />图表配置</div>
                  <label className="control-label">维度<NativeSelect value={dimension} onChange={(e) => setDimension(e.target.value)}>{dimensions.map((column) => <NativeSelectOption value={column.name} key={column.name}>{column.name}</NativeSelectOption>)}</NativeSelect></label>
                  <label className="control-label">指标<NativeSelect value={measure} onChange={(e) => setMeasure(e.target.value)}><NativeSelectOption value="__count">记录数</NativeSelectOption>{measures.map((column) => <NativeSelectOption value={column.name} key={column.name}>{column.name}</NativeSelectOption>)}</NativeSelect></label>
                  <label className="control-label">聚合<NativeSelect value={aggregation} onChange={(e) => setAggregation(e.target.value)}><NativeSelectOption value="sum">总和</NativeSelectOption><NativeSelectOption value="avg">平均值</NativeSelectOption><NativeSelectOption value="count">计数</NativeSelectOption></NativeSelect></label>
                  <div className="control-label">图形<div className="mt-2 grid grid-cols-2 gap-2"><Button variant={chartType === "bar" ? "default" : "outline"} onClick={() => setChartType("bar")}><BarChart3 className="size-4" />柱状</Button><Button variant={chartType === "line" ? "default" : "outline"} onClick={() => setChartType("line")}><LineChartIcon className="size-4" />折线</Button></div></div>
                  <p className="inspector-note">最多展示 30 个分组，所有聚合在浏览器中实时计算。</p>
                </aside>
                <section className="surface"><div className="surface-header"><div><p className="surface-title">{measure === "__count" ? "记录数" : measure}，按 {dimension}</p><p className="surface-caption">可视化预览</p></div></div><div className="p-5">{chart("h-[470px]")}</div></section>
              </div>
            </TabsContent>

            <TabsContent value="model" className="workspace-content">
              <div className="editor-grid">
                <aside className="inspector">
                  <div className="inspector-title"><FlaskConical className="size-4" />实验设置</div>
                  <label className="control-label">任务类型<NativeSelect value={modelTask} onChange={(e) => changeModelTask(e.target.value as ModelTask)}><NativeSelectOption value="regression">回归</NativeSelectOption><NativeSelectOption value="classification">分类</NativeSelectOption><NativeSelectOption value="forecast">时间序列预测</NativeSelectOption></NativeSelect></label>
                  <label className="control-label">训练模型<NativeSelect value={modelChoice} onChange={(e) => changeModelChoice(e.target.value as ModelChoice)}>{MODEL_OPTIONS[modelTask].map((option) => <NativeSelectOption key={option.value} value={option.value}>{option.label}</NativeSelectOption>)}</NativeSelect><span className="control-help">{MODEL_OPTIONS[modelTask].find((option) => option.value === modelChoice)?.description}</span></label>
                  <label className="control-label">目标字段<NativeSelect value={target} onChange={(e) => setTarget(e.target.value)}>{columns.map((column) => <NativeSelectOption key={column} value={column}>{column}</NativeSelectOption>)}</NativeSelect></label>
                  <Button onClick={createModelPlan} className="w-full"><WandSparkles className="size-4" />生成验证方案</Button>
                  <p className="inspector-note">确认切分与指标后，再由 Python Worker 真实训练。</p>
                </aside>
                <section className="surface min-h-[390px]">
                  <div className="surface-header"><div><p className="surface-title">验证方案</p><p className="surface-caption">训练前检查与评估设计</p></div></div>
                  {modelPlan ? <div className="p-5"><h3 className="text-lg font-semibold text-slate-900">{modelPlan.title}</h3><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">{modelPlan.summary}</p><div className="mt-5 divide-y divide-slate-100 border-y border-slate-200">{modelPlan.bullets.map((item, index) => <div key={item} className="flex gap-3 py-3 text-sm text-slate-700"><span className="text-xs tabular-nums text-slate-400">{String(index + 1).padStart(2, "0")}</span>{item}</div>)}</div><div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-500"><span className="rounded border border-slate-200 bg-slate-50 px-2 py-1">{modelPlan.method}</span><span className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-amber-700">{modelPlan.confidence}</span></div></div> : <div className="grid min-h-[320px] place-items-center text-center"><div><BrainCircuit className="mx-auto size-8 text-slate-300" /><p className="mt-3 text-sm font-medium text-slate-600">尚未生成验证方案</p><p className="mt-1 text-xs text-slate-400">在左侧选择任务、模型和目标字段。</p></div></div>}
                </section>
              </div>
              <PythonModelLab rows={rows} target={target} task={modelTask} modelChoice={modelChoice} datasetName={datasetName} onExperiment={recordExperiment} />
            </TabsContent>

            <TabsContent value="experiments" className="workspace-content">
              <section className="surface overflow-hidden">
                <div className="surface-header">
                  <div><p className="surface-title">实验历史与模型对比</p><p className="surface-caption">自动保存最近 30 次成功训练，仅保存在当前浏览器</p></div>
                  <Button size="sm" variant="ghost" disabled={!experiments.length} onClick={clearExperiments}><Trash2 className="size-4" />清空历史</Button>
                </div>
                {experiments.length ? <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>运行时间</TableHead><TableHead>数据集</TableHead><TableHead>任务 / 目标</TableHead><TableHead>模型</TableHead><TableHead>切分</TableHead><TableHead className="text-right">主指标</TableHead><TableHead className="text-right">相对基线</TableHead><TableHead className="text-right">样本 / 特征</TableHead></TableRow></TableHeader><TableBody>{experiments.map((experiment) => { const metric = experimentMetric(experiment); return <TableRow key={experiment.id}><TableCell className="whitespace-nowrap text-xs text-slate-500">{new Date(experiment.createdAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</TableCell><TableCell className="max-w-40 truncate text-slate-700">{experiment.datasetName}</TableCell><TableCell><span className="block text-slate-700">{experiment.task === "classification" ? "分类" : experiment.task === "forecast" ? "预测" : "回归"}</span><span className="text-xs text-slate-400">{experiment.target}</span></TableCell><TableCell className="font-medium text-slate-800">{experiment.modelName}</TableCell><TableCell className="max-w-52 text-xs leading-5 text-slate-500">{experiment.split}</TableCell><TableCell className="text-right tabular-nums"><span className="mr-1 text-xs text-slate-400">{metric.key}</span>{fmt(metric.value, 3)}</TableCell><TableCell className="text-right font-medium text-emerald-700">{experimentImprovement(experiment)}</TableCell><TableCell className="text-right tabular-nums text-slate-500">{experiment.rowsUsed} / {experiment.featureCount}</TableCell></TableRow>})}</TableBody></Table></div> : <div className="grid min-h-[360px] place-items-center text-center"><div><FlaskConical className="mx-auto size-8 text-slate-300" /><p className="mt-3 text-sm font-medium text-slate-600">还没有实验记录</p><p className="mt-1 text-xs text-slate-400">完成一次真实训练后，结果会自动出现在这里。</p></div></div>}
              </section>
            </TabsContent>
          </Tabs>
        </section>

        <aside className="pane pane-right">
          <div className="pane-heading">
            <div><p className="pane-title">分析助手</p><p className="pane-caption">解释、追问与复核</p></div>
            <span className="status-dot"><span />就绪</span>
          </div>
          <div className="assistant-scroll">
            <section className="assistant-result">
              <div className="flex items-center gap-2"><Sparkles className="size-4 text-blue-600" /><h2 className="text-sm font-semibold text-slate-900">{result.title}</h2></div>
              <p className="mt-3 text-sm leading-6 text-slate-700">{result.summary}</p>
              <div className="mt-3 space-y-2">{result.bullets.map((item) => <div key={item} className="flex gap-2 text-sm leading-5 text-slate-600"><ChevronRight className="mt-0.5 size-4 shrink-0 text-slate-400" />{item}</div>)}</div>
              <div className="result-meta"><span>方法</span>{result.method}<br /><span>状态</span>{result.confidence}</div>
            </section>
            <section className="assistant-section">
              <p className="section-label">快捷分析</p>
              <div className="flex flex-wrap gap-2">{["检查缺失值", "分析相关性", "查看时间趋势", "找出主要分组"].map((item) => <button key={item} onClick={() => runAnalysis(item)} className="prompt-chip">{item}</button>)}</div>
            </section>
            <section className="assistant-section">
              <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="描述你想了解的问题…" className="min-h-24 resize-none bg-white text-sm" />
              <Button onClick={() => runAnalysis()} className="mt-2 w-full"><Play className="size-4 fill-current" />运行本地分析</Button>
            </section>
            <LlmInsightPanel prompt={prompt} context={{ dataset: datasetName, profile, currentAnalysis: result }} />
            <section className="assistant-section border-t border-slate-200 pt-4">
              <div className="flex items-center justify-between text-xs"><span className="text-slate-500">可复现性检查</span><span className="font-medium text-emerald-700">4 / 4</span></div>
              <Progress value={100} className="mt-2 h-1" />
              <p className="mt-3 text-xs leading-5 text-slate-500">统计在浏览器执行；模型在隔离 Worker 训练；LLM 只接收统计摘要。</p>
            </section>
          </div>
        </aside>
      </div>
    </main>
  )
}
