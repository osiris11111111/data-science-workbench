"use client"

import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from "react"
import * as XLSX from "xlsx"
import { AreaChart, ArrowDownToLine, BarChart3, Bot, BrainCircuit, Check, ChevronRight, CircleAlert, Database, FileSpreadsheet, FlaskConical, LineChart as LineChartIcon, Loader2, Play, ScanSearch, ShieldCheck, Sparkles, Table2, UploadCloud, WandSparkles } from "lucide-react"
import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Progress } from "@/components/ui/progress"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"

type Cell = string | number | boolean | null
type DataRow = Record<string, Cell>
type ColumnKind = "number" | "date" | "category" | "boolean"
type ColumnProfile = { name: string; kind: ColumnKind; missing: number; unique: number; min?: number; max?: number; mean?: number }
type Profile = { rows: number; columns: number; missingCells: number; duplicateRows: number; numericColumns: number; columnProfiles: ColumnProfile[] }
type AnalysisResult = { title: string; summary: string; bullets: string[]; method: string; confidence: string }

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
  return <Badge variant="outline" className="border-white/10 bg-white/5 font-mono text-[10px] text-slate-300">{labels[kind]}</Badge>
}

export default function Home() {
  const [rows, setRows] = useState<DataRow[]>(demoRows), [datasetName, setDatasetName] = useState("SaaS 经营指标 · 示例"), [status, setStatus] = useState("示例数据已就绪"), [loading, setLoading] = useState(false)
  const [prompt, setPrompt] = useState("总结数据质量，并指出最值得关注的指标"), [result, setResult] = useState<AnalysisResult>(() => analyzeRows(demoRows, buildProfile(demoRows), "总结"))
  const [dimension, setDimension] = useState("month"), [measure, setMeasure] = useState("revenue"), [aggregation, setAggregation] = useState("sum"), [chartType, setChartType] = useState<"bar" | "line">("line")
  const [modelTask, setModelTask] = useState("regression"), [target, setTarget] = useState("revenue"), [modelPlan, setModelPlan] = useState<AnalysisResult | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const profile = useMemo(() => buildProfile(rows), [rows]), columns = profile.columnProfiles.map((column) => column.name), dimensions = profile.columnProfiles.filter((column) => column.kind !== "number"), measures = profile.columnProfiles.filter((column) => column.kind === "number")

  useEffect(() => { if (!columns.includes(dimension)) setDimension(dimensions[0]?.name ?? columns[0] ?? ""); if (!columns.includes(measure)) setMeasure(measures[0]?.name ?? "__count"); if (!columns.includes(target)) setTarget(measures[0]?.name ?? columns[0] ?? "") }, [columns.join("|"), dimension, measure, target])

  const chartData = useMemo(() => {
    if (!dimension) return []
    const groups = new Map<string, number[]>()
    rows.forEach((row) => { const key = String(row[dimension] ?? "缺失"), value = measure === "__count" ? 1 : row[measure]; if (typeof value === "number") groups.set(key, [...(groups.get(key) ?? []), value]) })
    return [...groups.entries()].map(([name, values]) => ({ name, value: aggregation === "count" ? values.length : aggregation === "avg" ? values.reduce((a, b) => a + b, 0) / values.length : values.reduce((a, b) => a + b, 0) })).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 30)
  }, [rows, dimension, measure, aggregation])
  const qualityScore = Math.max(0, Math.round(100 - (profile.missingCells / Math.max(profile.rows * profile.columns, 1)) * 80 - (profile.duplicateRows / Math.max(profile.rows, 1)) * 20))

  function loadDemo() { setRows(demoRows); setDatasetName("SaaS 经营指标 · 示例"); setStatus("示例数据已就绪"); setResult(analyzeRows(demoRows, buildProfile(demoRows), "总结")); return { rows: demoRows.length, columns: Object.keys(demoRows[0]).length } }
  async function readFile(file: File) {
    setLoading(true); setStatus(`正在读取 ${file.name}`)
    try {
      let parsed: DataRow[] = []
      if (/\.csv$/i.test(file.name)) parsed = parseCsv(await file.text())
      else if (/\.xlsx?$/i.test(file.name)) { const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" }), sheet = workbook.Sheets[workbook.SheetNames[0]], raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null, raw: true }); parsed = raw.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, coerceCell(value)]))) }
      else throw new Error("目前支持 CSV、XLSX 和 XLS")
      if (!parsed.length) throw new Error("文件中没有可读取的数据行")
      setRows(parsed); setDatasetName(file.name); setStatus(`已在浏览器中加载 ${parsed.length} 行`); setResult(analyzeRows(parsed, buildProfile(parsed), "总结")); setModelPlan(null)
    } catch (error) { setStatus(error instanceof Error ? error.message : "文件读取失败") }
    finally { setLoading(false); if (inputRef.current) inputRef.current.value = "" }
  }
  function runAnalysis(nextPrompt = prompt) { const next = analyzeRows(rows, profile, nextPrompt); setPrompt(nextPrompt); setResult(next); return next }
  function createModelPlan() {
    const targetProfile = profile.columnProfiles.find((column) => column.name === target), taskLabel = modelTask === "classification" ? "分类" : modelTask === "forecast" ? "时间序列预测" : "回归"
    setModelPlan({ title: `${taskLabel}验证方案`, summary: `目标字段为 ${target || "未选择"}；建议先建立简单基线，再与梯度提升模型比较。`, bullets: [modelTask === "forecast" ? "按时间顺序滚动切分，禁止随机打乱。" : "使用训练/验证/测试三段切分，并固定随机种子。", targetProfile?.missing ? `目标字段有 ${targetProfile.missing} 个缺失值，训练前需排除或补齐。` : "目标字段未发现缺失值。", modelTask === "classification" ? "主指标建议使用 F1 与 ROC-AUC，并检查类别不平衡。" : "主指标建议使用 MAE 与 RMSE，同时报告基线改进幅度。"], method: "任务类型、目标字段与数据质量联合检查", confidence: "训练前方案，尚未拟合模型" })
  }
  function exportReport() { const payload = { generatedAt: new Date().toISOString(), dataset: datasetName, profile, analysis: result, chart: { dimension, measure, aggregation, data: chartData }, modelPlan, note: "All calculations were executed locally in the browser." }, url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" })), anchor = document.createElement("a"); anchor.href = url; anchor.download = `${datasetName.replace(/[^\w\u4e00-\u9fa5]+/g, "-")}-analysis.json`; anchor.click(); URL.revokeObjectURL(url) }

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

  const chart = (height: string) => <ChartContainer config={{ value: { label: measure, color: "#22d3ee" } }} className={`${height} w-full aspect-auto`}>{chartType === "bar" ? <BarChart data={chartData}><CartesianGrid vertical={false} stroke="rgba(255,255,255,.07)" /><XAxis dataKey="name" tickLine={false} axisLine={false} minTickGap={24} /><YAxis tickLine={false} axisLine={false} width={58} tickFormatter={(value) => fmt(value, 0)} /><ChartTooltip content={<ChartTooltipContent />} /><Bar dataKey="value" fill="var(--color-value)" radius={[3, 3, 0, 0]} /></BarChart> : <LineChart data={chartData}><CartesianGrid vertical={false} stroke="rgba(255,255,255,.07)" /><XAxis dataKey="name" tickLine={false} axisLine={false} minTickGap={24} /><YAxis tickLine={false} axisLine={false} width={58} tickFormatter={(value) => fmt(value, 0)} /><ChartTooltip content={<ChartTooltipContent />} /><Line dataKey="value" type="monotone" stroke="var(--color-value)" strokeWidth={2.5} dot={{ r: 3 }} /></LineChart>}</ChartContainer>

  return <main className="min-h-screen bg-[#071019] text-slate-100">
    <header className="sticky top-0 z-40 border-b border-white/8 bg-[#071019]/92 backdrop-blur-xl"><div className="mx-auto flex h-16 max-w-[1800px] items-center justify-between px-4 lg:px-6"><div className="flex items-center gap-3"><div className="grid size-9 place-items-center border border-cyan-400/40 bg-cyan-400/10 text-cyan-300"><AreaChart className="size-5" /></div><div><div className="font-semibold tracking-tight">LensLab</div><div className="text-[10px] uppercase tracking-[0.22em] text-slate-500">Data science workbench</div></div></div><div className="hidden items-center gap-2 text-xs text-slate-400 sm:flex"><span className="size-1.5 rounded-full bg-emerald-400" />数据仅保留在当前浏览器</div><Button onClick={exportReport} variant="outline" className="border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 hover:text-white"><ArrowDownToLine className="size-4" />导出报告</Button></div></header>
    <div className="mx-auto grid max-w-[1800px] gap-4 p-4 lg:grid-cols-[260px_minmax(0,1fr)_340px] lg:p-6">
      <aside className="space-y-4">
        <Card className="border-white/8 bg-[#0b1621] shadow-none"><CardHeader className="pb-3"><div className="flex items-center justify-between"><CardTitle className="text-sm font-medium text-slate-200">数据集</CardTitle><Database className="size-4 text-cyan-300" /></div></CardHeader><CardContent className="space-y-3">
          <div onDragOver={(event) => event.preventDefault()} onDrop={(event: DragEvent<HTMLDivElement>) => { event.preventDefault(); const file = event.dataTransfer.files?.[0]; if (file) void readFile(file) }} className="group border border-dashed border-white/15 bg-black/10 p-4 text-center transition hover:border-cyan-400/50 hover:bg-cyan-400/5">{loading ? <Loader2 className="mx-auto size-6 animate-spin text-cyan-300" /> : <UploadCloud className="mx-auto size-6 text-slate-500 group-hover:text-cyan-300" />}<p className="mt-2 text-xs text-slate-300">拖入 CSV / Excel</p><p className="mt-1 text-[11px] text-slate-600">本地解析，不上传服务器</p><Input ref={inputRef} type="file" accept=".csv,.xlsx,.xls" onChange={(event: ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if (file) void readFile(file) }} className="hidden" /><Button size="sm" variant="outline" className="mt-3 w-full border-white/10 bg-white/5" onClick={() => inputRef.current?.click()}>选择文件</Button></div>
          <button onClick={loadDemo} className="flex w-full items-center gap-3 border border-cyan-400/20 bg-cyan-400/8 p-3 text-left transition hover:bg-cyan-400/12"><FileSpreadsheet className="size-4 shrink-0 text-cyan-300" /><span className="min-w-0"><span className="block truncate text-xs font-medium text-slate-200">{datasetName}</span><span className="block text-[11px] text-slate-500">{profile.rows} 行 · {profile.columns} 列</span></span></button>
          <div className="flex items-start gap-2 text-[11px] text-slate-500"><ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-emerald-400" /><span>{status}</span></div>
        </CardContent></Card>
        <Card className="border-white/8 bg-[#0b1621] shadow-none"><CardHeader className="pb-3"><CardTitle className="text-sm font-medium text-slate-200">工作流</CardTitle></CardHeader><CardContent className="space-y-1">{[[Check,"01","载入与字段识别","complete"],[ScanSearch,"02","探索与质量检查","active"],[BarChart3,"03","可视化与统计","next"],[BrainCircuit,"04","建模与验证","next"]].map(([Icon, number, label, state]) => { const ItemIcon = Icon as typeof Check; return <div key={String(number)} className={`flex items-center gap-3 px-2 py-2.5 text-xs ${state === "active" ? "bg-white/5 text-white" : "text-slate-500"}`}><ItemIcon className={`size-4 ${state === "complete" ? "text-emerald-400" : state === "active" ? "text-cyan-300" : "text-slate-600"}`} /><span className="font-mono text-[10px]">{String(number)}</span><span>{String(label)}</span></div> })}</CardContent></Card>
      </aside>

      <section className="min-w-0 space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[["记录",fmt(profile.rows,0),Table2,"当前分析粒度"],["字段",fmt(profile.columns,0),Database,`${profile.numericColumns} 个数值型`],["缺失",fmt(profile.missingCells,0),CircleAlert,profile.missingCells ? "需要处理" : "未发现问题"],["质量分",`${qualityScore}/100`,ShieldCheck,"基础完整性评分"]].map(([label,value,Icon,helper]) => { const MetricIcon = Icon as typeof Table2; return <Card key={String(label)} className="border-white/8 bg-[#0b1621] shadow-none"><CardContent className="flex items-start justify-between p-4"><div><p className="text-xs text-slate-500">{String(label)}</p><p className="mt-2 font-mono text-2xl font-semibold text-white">{String(value)}</p><p className="mt-1 text-[11px] text-slate-600">{String(helper)}</p></div><MetricIcon className="size-4 text-cyan-300/70" /></CardContent></Card> })}</div>
        <Card className="border-white/8 bg-[#0b1621] shadow-none"><Tabs defaultValue="overview"><div className="flex flex-col gap-3 border-b border-white/8 px-4 pt-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-medium text-white">分析工作台</p><p className="mt-1 text-xs text-slate-500">字段画像、聚合图表与建模设计</p></div><TabsList className="h-9 bg-black/20"><TabsTrigger value="overview">概览</TabsTrigger><TabsTrigger value="data">数据</TabsTrigger><TabsTrigger value="chart">图表</TabsTrigger><TabsTrigger value="model">建模</TabsTrigger></TabsList></div>
          <TabsContent value="overview" className="m-0 p-4"><div className="grid gap-4 xl:grid-cols-[1.45fr_.85fr]"><div className="border border-white/8 bg-[#08121b] p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-medium">{measure === "__count" ? "记录数" : measure} / {dimension}</p><p className="mt-1 text-[11px] text-slate-500">{aggregation === "avg" ? "平均值" : aggregation === "count" ? "计数" : "总和"} · 浏览器实时计算</p></div><div className="flex gap-1 border border-white/8 bg-black/15 p-1"><Button size="sm" variant={chartType === "bar" ? "secondary" : "ghost"} onClick={() => setChartType("bar")} className="h-7 px-2"><BarChart3 className="size-3.5" /></Button><Button size="sm" variant={chartType === "line" ? "secondary" : "ghost"} onClick={() => setChartType("line")} className="h-7 px-2"><LineChartIcon className="size-3.5" /></Button></div></div>{chart("h-[310px] mt-4")}</div><div className="space-y-4"><div className="border border-white/8 bg-[#08121b] p-4"><div className="flex items-center justify-between"><p className="text-sm font-medium">数据健康度</p><span className="font-mono text-xs text-emerald-400">{qualityScore}%</span></div><Progress value={qualityScore} className="mt-3 h-1.5" /><div className="mt-4 space-y-3 text-xs"><div className="flex justify-between text-slate-400"><span>缺失值</span><span>{profile.missingCells}</span></div><div className="flex justify-between text-slate-400"><span>重复行</span><span>{profile.duplicateRows}</span></div><div className="flex justify-between text-slate-400"><span>字段类型</span><span>已识别 {profile.columns}/{profile.columns}</span></div></div></div><div className="border border-emerald-400/15 bg-emerald-400/5 p-4"><div className="flex items-center gap-2 text-sm font-medium text-emerald-300"><ShieldCheck className="size-4" />复核状态</div><div className="mt-3 space-y-2 text-xs text-slate-400">{["计算口径可追踪","图表字段已绑定","输出包含方法说明","原始数据未离开浏览器"].map((item) => <div key={item} className="flex items-center gap-2"><Check className="size-3.5 text-emerald-400" />{item}</div>)}</div></div></div></div></TabsContent>
          <TabsContent value="data" className="m-0 p-4"><div className="overflow-hidden border border-white/8"><Table><TableHeader className="bg-black/20"><TableRow className="border-white/8 hover:bg-transparent"><TableHead>字段</TableHead><TableHead>类型</TableHead><TableHead className="text-right">缺失</TableHead><TableHead className="text-right">唯一值</TableHead><TableHead className="text-right">均值 / 范围</TableHead></TableRow></TableHeader><TableBody>{profile.columnProfiles.map((column) => <TableRow key={column.name} className="border-white/8 hover:bg-white/3"><TableCell className="font-mono text-xs text-slate-200">{column.name}</TableCell><TableCell><KindBadge kind={column.kind} /></TableCell><TableCell className="text-right font-mono text-xs text-slate-400">{column.missing}</TableCell><TableCell className="text-right font-mono text-xs text-slate-400">{column.unique}</TableCell><TableCell className="text-right font-mono text-xs text-slate-400">{column.kind === "number" ? `${fmt(column.mean)} · ${fmt(column.min)}–${fmt(column.max)}` : "—"}</TableCell></TableRow>)}</TableBody></Table></div><div className="mt-4 overflow-x-auto border border-white/8"><Table><TableHeader className="bg-black/20"><TableRow className="border-white/8 hover:bg-transparent">{columns.slice(0,8).map((column) => <TableHead key={column} className="whitespace-nowrap font-mono text-[11px]">{column}</TableHead>)}</TableRow></TableHeader><TableBody>{rows.slice(0,8).map((row,index) => <TableRow key={index} className="border-white/8 hover:bg-white/3">{columns.slice(0,8).map((column) => <TableCell key={column} className="whitespace-nowrap font-mono text-xs text-slate-400">{String(row[column] ?? "—")}</TableCell>)}</TableRow>)}</TableBody></Table></div></TabsContent>
          <TabsContent value="chart" className="m-0 p-4"><div className="grid gap-4 xl:grid-cols-[280px_1fr]"><div className="space-y-4 border border-white/8 bg-[#08121b] p-4"><div><label className="mb-2 block text-xs text-slate-400">维度</label><NativeSelect value={dimension} onChange={(e) => setDimension(e.target.value)} className="w-full border-white/10 bg-black/20">{dimensions.map((column) => <NativeSelectOption value={column.name} key={column.name}>{column.name}</NativeSelectOption>)}</NativeSelect></div><div><label className="mb-2 block text-xs text-slate-400">指标</label><NativeSelect value={measure} onChange={(e) => setMeasure(e.target.value)} className="w-full border-white/10 bg-black/20"><NativeSelectOption value="__count">记录数</NativeSelectOption>{measures.map((column) => <NativeSelectOption value={column.name} key={column.name}>{column.name}</NativeSelectOption>)}</NativeSelect></div><div><label className="mb-2 block text-xs text-slate-400">聚合</label><NativeSelect value={aggregation} onChange={(e) => setAggregation(e.target.value)} className="w-full border-white/10 bg-black/20"><NativeSelectOption value="sum">总和</NativeSelectOption><NativeSelectOption value="avg">平均值</NativeSelectOption><NativeSelectOption value="count">计数</NativeSelectOption></NativeSelect></div><div><label className="mb-2 block text-xs text-slate-400">图形</label><div className="grid grid-cols-2 gap-2"><Button variant={chartType === "bar" ? "secondary" : "outline"} onClick={() => setChartType("bar")}><BarChart3 className="size-4" />柱状</Button><Button variant={chartType === "line" ? "secondary" : "outline"} onClick={() => setChartType("line")}><LineChartIcon className="size-4" />折线</Button></div></div><div className="border-t border-white/8 pt-4 text-[11px] leading-5 text-slate-500">最多展示 30 个分组，并在浏览器端实时聚合。</div></div><div className="border border-white/8 bg-[#08121b] p-4">{chart("h-[420px]")}</div></div></TabsContent>
          <TabsContent value="model" className="m-0 p-4"><div className="grid gap-4 xl:grid-cols-[320px_1fr]"><div className="space-y-4 border border-white/8 bg-[#08121b] p-4"><div className="flex items-center gap-2"><FlaskConical className="size-4 text-cyan-300" /><p className="text-sm font-medium">实验设计</p></div><div><label className="mb-2 block text-xs text-slate-400">任务类型</label><NativeSelect value={modelTask} onChange={(e) => setModelTask(e.target.value)} className="w-full border-white/10 bg-black/20"><NativeSelectOption value="regression">回归</NativeSelectOption><NativeSelectOption value="classification">分类</NativeSelectOption><NativeSelectOption value="forecast">时间序列预测</NativeSelectOption></NativeSelect></div><div><label className="mb-2 block text-xs text-slate-400">目标字段</label><NativeSelect value={target} onChange={(e) => setTarget(e.target.value)} className="w-full border-white/10 bg-black/20">{columns.map((column) => <NativeSelectOption key={column} value={column}>{column}</NativeSelectOption>)}</NativeSelect></div><Button onClick={createModelPlan} className="w-full bg-cyan-300 text-slate-950 hover:bg-cyan-200"><WandSparkles className="size-4" />生成验证方案</Button><p className="text-[11px] leading-5 text-slate-500">这一版生成可复核的训练前方案，不会假装已经训练模型。</p></div><div className="border border-white/8 bg-[#08121b] p-5">{modelPlan ? <div><Badge className="bg-violet-400/10 text-violet-300">MODEL PLAN</Badge><h3 className="mt-4 text-xl font-semibold">{modelPlan.title}</h3><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">{modelPlan.summary}</p><div className="mt-5 grid gap-3">{modelPlan.bullets.map((item,index) => <div key={item} className="flex gap-3 border border-white/8 bg-white/3 p-3 text-sm text-slate-300"><span className="font-mono text-xs text-cyan-300">0{index+1}</span>{item}</div>)}</div><div className="mt-5 flex flex-wrap gap-2 text-[11px] text-slate-500"><span className="border border-white/8 px-2 py-1">{modelPlan.method}</span><span className="border border-amber-400/20 bg-amber-400/5 px-2 py-1 text-amber-300">{modelPlan.confidence}</span></div></div> : <div className="grid min-h-[360px] place-items-center text-center"><div><BrainCircuit className="mx-auto size-10 text-slate-700" /><p className="mt-4 text-sm text-slate-300">尚未生成实验方案</p><p className="mt-2 text-xs text-slate-600">选择任务与目标字段后开始。</p></div></div>}</div></div></TabsContent>
        </Tabs></Card>
      </section>

      <aside><Card className="sticky top-20 border-cyan-400/15 bg-[#0b1621] shadow-[0_0_40px_rgba(8,145,178,.07)]"><CardHeader className="border-b border-white/8 pb-4"><div className="flex items-center justify-between"><div className="flex items-center gap-2"><div className="grid size-8 place-items-center bg-cyan-400/10 text-cyan-300"><Bot className="size-4" /></div><div><CardTitle className="text-sm">分析 Agent</CardTitle><p className="mt-1 text-[10px] uppercase tracking-[.16em] text-slate-600">Local deterministic engine</p></div></div><Badge variant="outline" className="border-emerald-400/20 bg-emerald-400/5 text-[10px] text-emerald-300">READY</Badge></div></CardHeader><CardContent className="space-y-4 p-4">
        <div className="border border-cyan-400/15 bg-cyan-400/5 p-4"><div className="flex items-center gap-2"><Sparkles className="size-4 text-cyan-300" /><span className="text-sm font-medium text-cyan-100">{result.title}</span></div><p className="mt-3 text-sm leading-6 text-slate-300">{result.summary}</p><div className="mt-4 space-y-2">{result.bullets.map((item) => <div key={item} className="flex gap-2 text-xs leading-5 text-slate-400"><ChevronRight className="mt-0.5 size-3.5 shrink-0 text-cyan-400" />{item}</div>)}</div><div className="mt-4 border-t border-white/8 pt-3 text-[10px] leading-4 text-slate-600"><span className="text-slate-500">方法：</span>{result.method}<br /><span className="text-slate-500">状态：</span>{result.confidence}</div></div>
        <div className="space-y-2"><p className="text-[11px] uppercase tracking-[.14em] text-slate-600">快速任务</p><div className="flex flex-wrap gap-2">{["检查缺失值","分析相关性","查看时间趋势","找出主要分组"].map((item) => <button key={item} onClick={() => runAnalysis(item)} className="border border-white/8 bg-white/3 px-2.5 py-1.5 text-[11px] text-slate-400 transition hover:border-cyan-400/30 hover:text-cyan-200">{item}</button>)}</div></div>
        <div className="space-y-2"><Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="例如：检查数据质量，找出异常与趋势" className="min-h-24 resize-none border-white/10 bg-black/20 text-sm placeholder:text-slate-700" /><Button onClick={() => runAnalysis()} className="w-full bg-cyan-300 text-slate-950 hover:bg-cyan-200"><Play className="size-4 fill-current" />运行分析</Button></div>
        <div className="border-t border-white/8 pt-4"><div className="flex items-center justify-between text-xs"><span className="text-slate-500">可复现性检查</span><span className="font-mono text-emerald-400">4/4</span></div><Progress value={100} className="mt-2 h-1" /><p className="mt-3 text-[11px] leading-5 text-slate-600">当前 Agent 使用确定性浏览器计算，不调用外部模型。后续可接入受控 LLM 与 Python。</p></div>
      </CardContent></Card></aside>
    </div>
  </main>
}
