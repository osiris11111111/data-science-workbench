export type ModelTask = "regression" | "classification" | "forecast"
export type ModelChoice =
  | "auto"
  | "linear_regression"
  | "ridge"
  | "logistic_regression"
  | "random_forest"
  | "gradient_boosting"

export type ModelOption = {
  value: ModelChoice
  label: string
  description: string
}

export const MODEL_OPTIONS: Record<ModelTask, readonly ModelOption[]> = {
  regression: [
    { value: "auto", label: "自动比较", description: "训练全部候选模型，并按测试集 MAE 选择结果。" },
    { value: "linear_regression", label: "线性回归", description: "速度快、可解释，适合作为线性关系基线。" },
    { value: "ridge", label: "岭回归", description: "带正则化的线性模型，对共线特征更稳健。" },
    { value: "random_forest", label: "随机森林回归", description: "可学习非线性关系与特征交互。" },
    { value: "gradient_boosting", label: "梯度提升回归", description: "逐步拟合残差，通常有更强的表格数据表现。" },
  ],
  classification: [
    { value: "auto", label: "自动比较", description: "训练全部候选模型，并按测试集加权 F1 选择结果。" },
    { value: "logistic_regression", label: "逻辑回归", description: "可解释的概率分类基线。" },
    { value: "random_forest", label: "随机森林分类", description: "适合非线性边界与混合特征。" },
    { value: "gradient_boosting", label: "梯度提升分类", description: "面向表格数据的逐步提升模型。" },
  ],
  forecast: [
    { value: "auto", label: "自动比较", description: "按时间留后切分，比较全部候选回归模型。" },
    { value: "linear_regression", label: "线性趋势回归", description: "使用时间索引与可用特征拟合线性趋势。" },
    { value: "ridge", label: "岭回归趋势", description: "对展开后的相关特征增加正则化约束。" },
    { value: "random_forest", label: "随机森林预测", description: "学习非线性时间与业务特征关系。" },
    { value: "gradient_boosting", label: "梯度提升预测", description: "以提升树拟合非线性变化。" },
  ],
}

export function modelLabel(task: ModelTask, choice: ModelChoice) {
  return MODEL_OPTIONS[task].find((option) => option.value === choice)?.label ?? choice
}

