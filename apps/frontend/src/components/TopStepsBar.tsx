import { Steps } from 'antd';

const ITEMS = [
  { title: '第 1 步 · 创建知识库', content: '按业务场景创建知识库' },
  { title: '第 2 步 · 上传文档', content: 'CSV/XLSX 转 CSV 后进入 Loader 与 Splitter' },
  { title: '第 3 步 · 检索问答', content: '调试 topK、阈值、切片命中与答案引用' },
  { title: '第 4 步 · API 调用', content: '通过 SSE 接口集成到真实业务流程' },
];

/** 页面顶部引导步骤条（antd Steps，两种步骤条统一为此实现） */
export default function TopStepsBar({ active }: { active: number }) {
  return (
    <div className="top-steps">
      <Steps size="small" current={active} items={ITEMS} />
    </div>
  );
}
