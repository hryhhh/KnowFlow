import { Tag } from 'antd';

const MAP = {
  pending: { color: 'default', label: '待处理' },
  processing: { color: 'processing', label: '处理中' },
  success: { color: 'success', label: '处理成功' },
  failed: { color: 'error', label: '处理失败' },
} as const;

/** 文档处理状态徽章（antd Tag） */
export default function StatusBadge({
  status,
}: {
  status: 'pending' | 'processing' | 'success' | 'failed';
}) {
  const m = MAP[status] ?? MAP.pending;
  return <Tag color={m.color}>{m.label}</Tag>;
}
