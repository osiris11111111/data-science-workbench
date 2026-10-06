"use client"

import { useState } from "react"
import { BrainCircuit, Loader2, Sparkles } from "lucide-react"

import { Button } from "@/components/ui/button"

type Props = {
  prompt: string
  context: unknown
}

export function LlmInsightPanel({ prompt, context }: Props) {
  const [loading, setLoading] = useState(false)
  const [answer, setAnswer] = useState("")
  const [error, setError] = useState("")
  const [model, setModel] = useState("")

  async function askLlm() {
    setLoading(true)
    setError("")
    try {
      const response = await fetch("/api/llm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, context }),
      })
      const payload = (await response.json()) as { text?: string; error?: string; model?: string }
      if (!response.ok) throw new Error(payload.error || "LLM 请求失败")
      setAnswer(payload.text ?? "")
      setModel(payload.model ?? "")
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "LLM 请求失败")
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="mx-3 mb-3 overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 px-3 pt-3 text-sm font-semibold text-slate-800">
          <BrainCircuit className="size-4" /> LLM 深度解读
        </div>
        <span className="mr-3 mt-3 text-[10px] text-slate-400">服务端</span>
      </div>
      <p className="px-3 pt-2 text-xs leading-5 text-slate-500">
        只向服务端发送字段画像和统计摘要，不发送完整数据集。
      </p>
      {answer ? (
        <div className="mx-3 mt-3 whitespace-pre-wrap rounded-md border border-slate-200 bg-white p-3 text-sm leading-6 text-slate-700">
          {answer}
          {model ? <div className="mt-3 text-[11px] text-slate-400">模型：{model}</div> : null}
        </div>
      ) : null}
      {error ? <div className="mx-3 mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-700">{error}</div> : null}
      <Button
        onClick={askLlm}
        disabled={loading}
        variant="outline"
        className="m-3 w-[calc(100%_-_1.5rem)] border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
      >
        {loading ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
        {loading ? "正在分析" : answer ? "重新解读" : "调用 LLM"}
      </Button>
    </section>
  )
}
