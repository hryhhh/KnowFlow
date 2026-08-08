const STEPS = [
  { title: "创建知识库", desc: "按业务场景创建知识库" },
  { title: "上传文档", desc: "CSV/XLSX 转 CSV 后进入 Loader 与 Splitter" },
  { title: "检索问答", desc: "调试 topK、阈值、切片命中与答案引用" },
  { title: "API 调用", desc: "通过 SSE 接口集成到真实业务流程" },
];

export default function TopStepsBar({ active }: { active: number }) {
  return (
    <div className="steps">
      {STEPS.map((s, i) => (
        <div key={i} className={"step" + (i === active ? " active" : "")}>
          <b>
            第 {i + 1} 步 · {s.title}
          </b>
          {s.desc}
        </div>
      ))}
    </div>
  );
}
