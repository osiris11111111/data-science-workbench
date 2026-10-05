"use client"

import { useState } from "react"
import { BrainCircuit, Loader2, Sparkles } from "lucide-react"

import { Badge } from "@/components/ui/badge"
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
    <div className="border border-violet-400/15 bg-violet-400/5 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-medium text-violet-200">
          <BrainCircuit className="size-4" /> LLM 深度解读
        </div>
        <Badge variant="outline" className="border-violet-400/20 text-[10px] text-violet-300">
          SERVER API
        </Badge>
      </div>
      <p className="mt-2 text-xs leading-5 text-slate-500">
        只向服务端发送字段画像和统计摘要，不发送完整数据集。
      </p>
      {answer ? (
        <div className="mt-3 whitespace-pre-wrap border border-white/8 bg-black/15 p-3 text-sm leading-6 text-slate-300">
          {answer}
          {model ? <div className="mt-3 text-[11px] text-slate-600">模型：{model}</div> : null}
        </div>
      ) : null}
      {error ? <div className="mt-3 border border-amber-400/20 bg-amber-400/5 p-3 text-xs leading-5 text-amber-200">{error}</div> : null}
      <Button
        onClick={askLlm}
        disabled={loading}
        variant="outline"
        className="mt-3 w-full border-violet-400/25 bg-violet-400/8 text-violet-100 hover:bg-violet-400/15 hover:text-white"
      >
        {loading ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
        {loading ? "正在分析" : answer ? "重新解读" : "调用 LLM"}
      </Button>
    </div>
  )
}
