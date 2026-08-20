import { useEffect, useState, useRef } from 'react';
import type { ChangeEvent } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Select } from 'antd';
import PageHeader from '../../components/PageHeader';
import TopStepsBar from '../../components/TopStepsBar';
import StatusBadge from '../../components/StatusBadge';
import { docApi } from '../../services/api';
import { useKbStore } from '../../stores/kb-store';
import type { DocListItem } from '../../types';
import { Upload, Search, Trash2, Cpu } from 'lucide-react';

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
  const [dragOver, setDragOver] = useState(false);
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

  const fileRef = useRef<HTMLInputElement>(null);

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

  const handleDrop = (e: React.DragEvent) => {
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) onUpload(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = () => setDragOver(false);

  const deleteDoc = async (kbId: string, docId: string) => {
    await docApi.remove(kbId, docId);
    await load();
    await refreshCurrent();
  };

  return (
    <div className="content">
      <PageHeader title="文档管理" breadcrumb={current?.name ?? kbId} />
      <TopStepsBar active={1} />

      <div className="toolbar">
        <button
          className="btn primary"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
        >
          <Upload size={16} /> {uploading ? '上传中…' : '上传文档'}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.xlsx,.xls,.pdf,.docx,.doc"
          style={{ display: 'none' }}
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            const file = e.target.files?.[0];
            if (file) onUpload(file);
          }}
        />
        <span style={{ color: 'var(--text-sub)', fontSize: 12 }}>支持 CSV / XLSX / PDF / Word</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Cpu size={14} style={{ color: 'var(--text-subtle)', flexShrink: 0 }} />
          <Select
            value={selectedStrategy}
            onChange={(v) => setSelectedStrategy(v as ParseStrategy)}
            options={STRATEGY_OPTIONS}
            style={{ width: 190 }}
            size="small"
          />
        </div>
        <span className="spacer" />
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            border: '1px solid var(--border-strong)',
            borderRadius: 'var(--radius)',
            background: 'var(--panel)',
            overflow: 'hidden',
          }}
        >
          <Search
            size={16}
            style={{
              padding: '0 8px',
              color: 'var(--text-subtle)',
              borderRight: '1px solid var(--border)',
              flexShrink: 0,
            }}
          />
          <input
            className="search-input"
            style={{ border: 'none', borderRadius: 0, boxShadow: 'none', width: 200 }}
            placeholder="搜索文件名"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {error && (
        <div className="badge failed" style={{ marginBottom: 12, display: 'inline-block' }}>
          {error}
        </div>
      )}

      {/* 拖拽上传区 */}
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => fileRef.current?.click()}
        style={{
          border: `2px dashed ${dragOver ? 'var(--primary)' : 'var(--border-strong)'}`,
          borderRadius: 'var(--radius-lg)',
          padding: '24px',
          textAlign: 'center',
          margin: '0 0 16px',
          cursor: 'pointer',
          background: dragOver ? 'var(--primary-soft)' : 'transparent',
          transition: 'all 0.2s',
        }}
      >
        <div style={{ color: 'var(--text)', fontWeight: 500 }}>
          {dragOver ? '拖放文件到此处上传' : '拖放文件到此处，或点击选择文件'}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 4 }}>
          支持 CSV / XLSX / PDF / DOCX / DOC 格式
        </div>
      </div>

      {docs.length === 0 ? (
        <div className="empty">
          <p>暂无文档</p>
          <p>上传 CSV / XLSX / PDF / Word 开始</p>
        </div>
      ) : (
        <>
          <table className="table">
            <thead>
              <tr>
                <th>文档名称</th>
                <th>状态</th>
                <th>处理策略</th>
                <th>切片数</th>
                <th>导入方式</th>
                <th>更新时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id}>
                  <td>
                    <strong>{d.name}</strong>
                  </td>
                  <td>
                    <StatusBadge status={d.status} />
                  </td>
                  <td>{d.strategy || '—'}</td>
                  <td>{d.chunkCount}</td>
                  <td>{d.importMethod}</td>
                  <td style={{ color: 'var(--text-subtle)', fontSize: 12 }}>{d.updatedAt}</td>
                  <td>
                    <button
                      className="act-btn"
                      onClick={() => navigate(`/knowledge-bases/${kbId}/documents/${d.id}/chunks`)}
                    >
                      切片详情
                    </button>
                    <button
                      className="act-btn danger"
                      style={{ marginLeft: 6 }}
                      onClick={() => deleteDoc(d.kbId, d.id)}
                    >
                      <Trash2 size={14} /> 删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
