import type { Metadata } from "next"
import "./globals.css"

export const metadata: Metadata = {
  title: "LensLab · Data Science Workbench",
  description: "面向数据分析师与数据科学家的交互式本地分析工作台。",
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN" className="dark"><body>{children}</body></html>
}
