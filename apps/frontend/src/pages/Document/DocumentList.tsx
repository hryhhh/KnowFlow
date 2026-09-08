import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  Button,
  Empty,
  Input,
  Popconfirm,
  Progress,
  Select,
  Table,
  Tooltip,
  Upload,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { InboxOutlined } from '@ant-design/icons';
import { Trash2 } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import TopStepsBar from '../../components/TopStepsBar';
import StatusBadge from '../../components/StatusBadge';
import { docApi } from '../../services/api';
import { useKbStore } from '../../stores/kb-store';
import type { DocListItem } from '../../types';

type ParseStrategy = 'mineru' | 'mineru-agent' | 'basic';

const STRATEGY_OPTIONS: { value: ParseStrategy; label: string }[] = [
  { value: 'mineru-agent', label: 'mineru-agent（默认）' },
  { value: 'mineru', label: 'mineru（自托管）' },
  { value: 'basic', label: 'basic（兜底）' },
];

export default function DocumentList() {
  const { kbId } = useParams();
  const navigate = useNavigate();
  const current = useKbStore((s) => s.current);
  const refreshCurrent = useKbStore((s) => s.refreshCurrent);
  const [docs, setDocs] = useState<DocListItem[]>([]);
  const [search, setSearch] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [selectedStrategy, setSelectedStrategy] = useState<ParseStrategy>('mineru-agent');

  const load = async () => {
    if (!kbId) return;
    const res = await docApi.list(kbId, search || undefined);
    setDocs(res.data.data);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kbId, search]);

  // Auto-polling every 5s to reflect upload/processing status changes
  useEffect(() => {
    if (!kbId) return;
    const interval = setInterval(() => load(), 5000);
    return () => clearInterval(interval);
  }, [kbId, search]);

  const onUpload = async (file: File) => {
    if (!kbId || !file) return;
    setUploading(true);
    setError('');
    try {
      await docApi.upload(kbId, file, selectedStrategy);
      await load();
      await refreshCurrent();
    } catch (err) {
      setError(err instanceof Error ? err.message : '上传失败');
    } finally {
      setUploading(false);
    }
  };

  const deleteDoc = async (docKbId: string, docId: string) => {
    await docApi.remove(docKbId, docId);
    await load();
    await refreshCurrent();
  };

  const columns: ColumnsType<DocListItem> = [
    {
      title: '文档名称',
      dataIndex: 'name',
      ellipsis: true,
      render: (name: string) => <strong>{name}</strong>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 180,
      render: (_, d) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <StatusBadge status={d.status} />
          {d.status === 'processing' && (
            <Progress
              size="small"
              percent={d.progress ?? 0}
              style={{ minWidth: 100, marginBottom: 0 }}
            />
          )}
          {d.status === 'failed' && d.errorMessage && (
            <Tooltip title={d.errorMessage}>
              <span
                style={{
                  fontSize: 11,
                  color: 'var(--danger, #ff4d4f)',
                  cursor: 'help',
                  maxWidth: 200,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  display: 'block',
                }}
              >
                {d.errorMessage.slice(0, 200)}
              </span>
            </Tooltip>
          )}
        </div>
      ),
    },
    { title: '处理策略', dataIndex: 'strategy', width: 120, render: (v: string) => v || '—' },
    { title: '切片数', dataIndex: 'chunkCount', width: 90 },
    { title: '导入方式', dataIndex: 'importMethod', width: 110 },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      width: 160,
      render: (v: string) => <span style={{ color: 'var(--text-subtle)', fontSize: 12 }}>{v}</span>,
    },
    {
      title: '操作',
      key: 'actions',
      width: 200,
      render: (_, d) => (
        <>
          <Button
            size="small"
            onClick={() => navigate(`/knowledge-bases/${kbId}/documents/${d.id}/chunks`)}
          >
            切片详情
          </Button>
          <Popconfirm title="确定要删除该文档吗？" onConfirm={() => deleteDoc(d.kbId, d.id)}>
            <Button size="small" danger icon={<Trash2 size={14} />} style={{ marginLeft: 6 }}>
              删除
            </Button>
          </Popconfirm>
        </>
      ),
    },
  ];

  return (
    <div className="content">
      <PageHeader title="文档管理" breadcrumb={current?.name ?? kbId} />
      <TopStepsBar active={1} />

      <div className="toolbar">
        <span style={{ color: 'var(--text-sub)', fontSize: 12 }}>支持 CSV / XLSX / PDF / Word</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Select
            value={selectedStrategy}
            onChange={(v) => setSelectedStrategy(v as ParseStrategy)}
            options={STRATEGY_OPTIONS}
            style={{ width: 190 }}
            size="small"
          />
        </div>
        <span className="spacer" />
        <Input.Search
          placeholder="搜索文件名"
          style={{ width: 220 }}
          allowClear
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {error && (
        <Alert
          type="error"
          showIcon
          message={error}
          style={{ marginBottom: 12 }}
          closable
          onClose={() => setError('')}
        />
      )}

      {/* 拖拽上传区（antd Upload.Dragger，beforeUpload 返回 false 走自定义上传） */}
      <Upload.Dragger
        accept=".csv,.xlsx,.xls,.pdf,.docx,.doc"
        showUploadList={false}
        multiple={false}
        disabled={uploading}
        beforeUpload={(file) => {
          onUpload(file);
          return false;
        }}
        style={{ marginBottom: 16, background: 'var(--panel)' }}
      >
        <p className="ant-upload-drag-icon">
          <InboxOutlined />
        </p>
        <p className="ant-upload-text" style={{ fontSize: 14 }}>
          {uploading ? '上传中…' : '拖放文件到此处，或点击选择文件'}
        </p>
        <p className="ant-upload-hint" style={{ fontSize: 12 }}>
          支持 CSV / XLSX / PDF / DOCX / DOC 格式
        </p>
      </Upload.Dragger>

      <Table
        rowKey="id"
        size="small"
        columns={columns}
        dataSource={docs}
        locale={{
          emptyText: (
            <Empty
              description="暂无文档，上传 CSV / XLSX / PDF / Word 开始"
              style={{ padding: '40px 0' }}
            />
          ),
        }}
        pagination={false}
      />
    </div>
  );
}
