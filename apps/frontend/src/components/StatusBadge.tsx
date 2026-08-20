export default function StatusBadge({
  status,
}: {
  status: 'pending' | 'processing' | 'success' | 'failed';
}) {
  const map = {
    pending: { cls: 'pending', label: '待处理' },
    processing: { cls: 'processing', label: '处理中' },
    success: { cls: 'success', label: '处理成功' },
    failed: { cls: 'failed', label: '处理失败' },
  } as const;
  const m = map[status] ?? map.pending;
  return <span className={`badge ${m.cls}`}>{m.label}</span>;
}
