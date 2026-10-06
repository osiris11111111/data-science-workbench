import { loadPyodide } from "https://cdn.jsdelivr.net/pyodide/v314.0.7/full/pyodide.mjs"

let runtimePromise

function progress(value, message) {
  self.postMessage({ type: "progress", progress: value, message })
}

async function runtime() {
  if (!runtimePromise) {
    progress(8, "正在下载 Python WebAssembly 运行时")
    runtimePromise = loadPyodide({
      indexURL: "https://cdn.jsdelivr.net/pyodide/v314.0.7/full/",
    })
  }
  return runtimePromise
}

self.onmessage = async (event) => {
  if (event.data?.type !== "train") return
  try {
    const pyodide = await runtime()
    progress(24, "正在加载 pandas 与 scikit-learn")
    await pyodide.loadPackage(["numpy", "pandas", "scikit-learn"])
    progress(44, "正在建立防泄漏预处理 Pipeline")

    pyodide.globals.set("payload_json", JSON.stringify(event.data.payload))
    const resultJson = await pyodide.runPythonAsync(`
import json, sys, math
import numpy as np
import pandas as pd
import sklearn
from sklearn.compose import ColumnTransformer
from sklearn.pipeline import Pipeline
from sklearn.impute import SimpleImputer
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from sklearn.model_selection import train_test_split
from sklearn.dummy import DummyRegressor, DummyClassifier
from sklearn.linear_model import LinearRegression, LogisticRegression, Ridge
from sklearn.ensemble import RandomForestRegressor, RandomForestClassifier, HistGradientBoostingRegressor, HistGradientBoostingClassifier
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score, accuracy_score, balanced_accuracy_score, f1_score, confusion_matrix

payload = json.loads(payload_json)
task = payload["task"]
target = payload["target"]
model_choice = payload.get("modelChoice", "auto")
seed = int(payload.get("seed", 42))
original_rows = int(payload.get("originalRows", len(payload["rows"])))
df = pd.DataFrame(payload["rows"])
warnings = []

if target not in df.columns:
    raise ValueError(f"目标字段 {target} 不存在")

df = df.replace([np.inf, -np.inf], np.nan)
df = df.dropna(subset=[target]).copy()
if len(df) < 8:
    raise ValueError("去除目标缺失后至少需要 8 行数据")

if original_rows > len(payload["rows"]):
    warnings.append(f"为保证浏览器稳定，本次使用前 {len(payload['rows'])} 行；原数据共有 {original_rows} 行。")

time_column = None
if task == "forecast":
    for column in [c for c in df.columns if c != target]:
        parsed = pd.to_datetime(df[column], errors="coerce")
        if parsed.notna().mean() >= 0.8:
            time_column = column
            df["__parsed_time__"] = parsed
            break
    if time_column is None:
        raise ValueError("时间序列任务需要至少一个可识别的日期字段")
    df = df.sort_values("__parsed_time__").drop(columns=["__parsed_time__"])
    df["__time_index__"] = np.arange(len(df), dtype=float)

y = df[target]
X = df.drop(columns=[target]).copy()

if task in ("regression", "forecast"):
    y = pd.to_numeric(y, errors="coerce")
    valid = y.notna()
    X, y = X.loc[valid], y.loc[valid]
    if y.nunique() < 2:
        raise ValueError("回归目标至少需要两个不同数值")
else:
    y = y.astype(str)
    if y.nunique() < 2:
        raise ValueError("分类目标至少需要两个类别")

drop_columns = []
for column in X.columns:
    if X[column].isna().all():
        drop_columns.append(column)
    elif (not pd.api.types.is_numeric_dtype(X[column])) and X[column].nunique(dropna=True) / max(len(X), 1) > 0.95:
        drop_columns.append(column)
        warnings.append(f"高基数字段 {column} 已排除，以降低 ID 泄漏风险。")
X = X.drop(columns=drop_columns)
if X.shape[1] == 0:
    raise ValueError("没有可用于训练的特征字段")

numeric_columns = X.select_dtypes(include=["number", "bool"]).columns.tolist()
categorical_columns = [c for c in X.columns if c not in numeric_columns]

numeric_pipe = Pipeline([
    ("impute", SimpleImputer(strategy="median")),
    ("scale", StandardScaler()),
])
categorical_pipe = Pipeline([
    ("impute", SimpleImputer(strategy="most_frequent")),
    ("encode", OneHotEncoder(handle_unknown="ignore", sparse_output=False, max_categories=40)),
])
transformers = []
if numeric_columns:
    transformers.append(("numeric", numeric_pipe, numeric_columns))
if categorical_columns:
    transformers.append(("category", categorical_pipe, categorical_columns))
preprocessor = ColumnTransformer(transformers=transformers, remainder="drop")

if task == "forecast":
    split_at = max(1, int(len(X) * 0.8))
    if len(X) - split_at < 2:
        split_at = len(X) - 2
    X_train, X_test = X.iloc[:split_at], X.iloc[split_at:]
    y_train, y_test = y.iloc[:split_at], y.iloc[split_at:]
    split_label = f"按 {time_column} 顺序切分 80/20"
else:
    stratify = None
    if task == "classification" and y.value_counts().min() >= 2 and y.nunique() <= max(2, int(len(y) * 0.2)):
        stratify = y
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=seed, shuffle=True, stratify=stratify
    )
    split_label = "固定随机种子独立测试集 80/20"

def clean_number(value):
    value = float(value)
    return value if math.isfinite(value) else None

def evaluate(name, estimator):
    pipeline = Pipeline([("prep", preprocessor), ("model", estimator)])
    pipeline.fit(X_train, y_train)
    prediction = pipeline.predict(X_test)
    if task == "classification":
        metrics = {
            "accuracy": clean_number(accuracy_score(y_test, prediction)),
            "balanced_accuracy": clean_number(balanced_accuracy_score(y_test, prediction)),
            "f1_weighted": clean_number(f1_score(y_test, prediction, average="weighted", zero_division=0)),
        }
    else:
        metrics = {
            "mae": clean_number(mean_absolute_error(y_test, prediction)),
            "rmse": clean_number(mean_squared_error(y_test, prediction) ** 0.5),
            "r2": clean_number(r2_score(y_test, prediction)) if len(y_test) > 1 else None,
        }
    return {"name": name, "metrics": metrics}, pipeline

if task == "classification":
    baseline_result, _ = evaluate("多数类基线", DummyClassifier(strategy="most_frequent"))
    model_specs = [
        ("logistic_regression", "逻辑回归", LogisticRegression(max_iter=1000, random_state=seed)),
        ("random_forest", "随机森林分类", RandomForestClassifier(n_estimators=120, max_depth=10, min_samples_leaf=2, random_state=seed, n_jobs=1)),
        ("gradient_boosting", "梯度提升分类", HistGradientBoostingClassifier(max_iter=120, learning_rate=0.08, max_leaf_nodes=15, random_state=seed)),
    ]
else:
    baseline_result, _ = evaluate("均值基线", DummyRegressor(strategy="mean"))
    model_specs = [
        ("linear_regression", "线性回归" if task == "regression" else "线性趋势回归", LinearRegression()),
        ("ridge", "岭回归" if task == "regression" else "岭回归趋势", Ridge(alpha=1.0)),
        ("random_forest", "随机森林回归" if task == "regression" else "随机森林预测", RandomForestRegressor(n_estimators=120, max_depth=10, min_samples_leaf=2, random_state=seed, n_jobs=1)),
        ("gradient_boosting", "梯度提升回归" if task == "regression" else "梯度提升预测", HistGradientBoostingRegressor(max_iter=120, learning_rate=0.08, max_leaf_nodes=15, random_state=seed)),
    ]

if model_choice != "auto":
    model_specs = [spec for spec in model_specs if spec[0] == model_choice]
    if not model_specs:
        raise ValueError(f"模型 {model_choice} 不支持当前任务类型")

candidates = []
pipelines = {}
for _, name, estimator in model_specs:
    candidate, fitted = evaluate(name, estimator)
    candidates.append(candidate)
    pipelines[name] = fitted

if task == "classification":
    best = max(candidates, key=lambda item: item["metrics"]["f1_weighted"])
else:
    best = min(candidates, key=lambda item: item["metrics"]["mae"])

best_pipeline = pipelines[best["name"]]
best_prediction = best_pipeline.predict(X_test)
feature_names = best_pipeline.named_steps["prep"].get_feature_names_out()
model = best_pipeline.named_steps["model"]
importance = None
if hasattr(model, "feature_importances_"):
    importance = np.asarray(model.feature_importances_)
elif hasattr(model, "coef_"):
    coefficients = np.asarray(model.coef_)
    importance = np.mean(np.abs(coefficients), axis=0) if coefficients.ndim > 1 else np.abs(coefficients)

top_features = []
if importance is not None and len(importance) == len(feature_names):
    normalizer = float(np.max(np.abs(importance))) or 1.0
    ranked = sorted(zip(feature_names, importance), key=lambda item: abs(float(item[1])), reverse=True)[:10]
    top_features = [{"name": str(name), "importance": clean_number(abs(value) / normalizer)} for name, value in ranked]

if task == "classification":
    actual_labels = pd.Series(y_test).astype(str).reset_index(drop=True)
    predicted_labels = pd.Series(best_prediction).astype(str).reset_index(drop=True)
    label_values = sorted(set(actual_labels.tolist()) | set(predicted_labels.tolist()))
    if len(label_values) > 8:
        top_labels = actual_labels.value_counts().head(7).index.tolist()
        actual_labels = actual_labels.where(actual_labels.isin(top_labels), "其他")
        predicted_labels = predicted_labels.where(predicted_labels.isin(top_labels), "其他")
        label_values = top_labels + ["其他"]
    matrix = confusion_matrix(actual_labels, predicted_labels, labels=label_values)
    diagnostics = {
        "kind": "classification",
        "labels": [str(value) for value in label_values],
        "matrix": matrix.astype(int).tolist(),
        "actual": actual_labels.head(200).tolist(),
        "predicted": predicted_labels.head(200).tolist(),
    }
else:
    actual_values = np.asarray(y_test, dtype=float)
    predicted_values = np.asarray(best_prediction, dtype=float)
    residual_values = actual_values - predicted_values
    diagnostics = {
        "kind": "regression",
        "actual": [clean_number(value) for value in actual_values[:200]],
        "predicted": [clean_number(value) for value in predicted_values[:200]],
        "residuals": [clean_number(value) for value in residual_values[:200]],
        "residualMean": clean_number(np.mean(residual_values)),
        "residualStd": clean_number(np.std(residual_values)),
    }

if len(X_test) < 20:
    warnings.append("测试集少于 20 行，指标波动可能很大；请把结果视为演示性证据。")
if task == "forecast":
    warnings.append("当前预测为单次留后评估；正式部署应增加滚动时间回测和季节性基线。")
else:
    warnings.append("当前运行使用单次独立测试集；正式决策前应在训练集内增加交叉验证。")

result = {
    "task": task,
    "target": target,
    "selectionMode": "auto" if model_choice == "auto" else "manual",
    "rowsUsed": int(len(X)),
    "trainRows": int(len(X_train)),
    "testRows": int(len(X_test)),
    "featureCount": int(len(feature_names)),
    "split": split_label,
    "baseline": baseline_result,
    "best": best,
    "candidates": candidates,
    "topFeatures": top_features,
    "diagnostics": diagnostics,
    "versions": {"python": sys.version.split()[0], "sklearn": sklearn.__version__, "pandas": pd.__version__},
    "warnings": warnings,
}
json.dumps(result, ensure_ascii=False)
    `)

    progress(92, "正在整理指标与模型清单")
    self.postMessage({ type: "result", result: JSON.parse(resultJson) })
  } catch (error) {
    self.postMessage({ type: "error", error: error instanceof Error ? error.message : String(error) })
  }
}
