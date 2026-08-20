import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import PageHeader from '../../components/PageHeader';
import TopStepsBar from '../../components/TopStepsBar';
import ChunkModal from './ChunkModal';
import { chunkApi } from '../../services/api';
import { useKbStore } from '../../stores/kb-store';
import type { ChunkCard } from '../../types';
import { Plus, Pencil, Trash2, Search } from 'lucide-react';

export default function KbChunkList() {
  const { kbId } = useParams();
  const current = useKbStore((s) => s.current);
  const refreshCurrent = useKbStore((s) => s.refreshCurrent);
  const [chunks, setChunks] = useState<ChunkCard[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [showModal, setShowModal] = useState(false);
  const [editingChunk, setEditingChunk] = useState<ChunkCard | null>(null);
  const pageSize = 10;

  useEffect(() => {
    if (!kbId) return;
    chunkApi.byKb(kbId, pageSize, page).then((res) => {
      setChunks(res.data.data.items);
      setTotal(res.data.data.total);
    });
  }, [kbId, page]);

  const refresh = () => {
    if (!kbId) return;
    chunkApi.byKb(kbId, pageSize, page).then((res) => {
      setChunks(res.data.data.items);
      setTotal(res.data.data.total);
    });
  };

  const handleCreate = async (selectedDocId: string, content: string, title?: string) => {
    await chunkApi.create(selectedDocId, { content, title });
    refresh();
    await refreshCurrent();
  };

  const handleUpdate = async (_docId: string, content: string, title?: string) => {
    if (!editingChunk) return;
    await chunkApi.update(editingChunk.id, { content, title });
    refresh();
    await refreshCurrent();
  };

  const handleDelete = async (chunkId: string) => {
    if (!window.confirm('确定要删除这个切片吗？')) return;
    await chunkApi.remove(chunkId);
    refresh();
    await refreshCurrent();
  };

  const pages = Math.ceil(total / pageSize);

  return (
    <div className="content">
      <PageHeader title="切片管理" breadcrumb={current?.name ?? kbId} />
      <TopStepsBar active={1} />

      <div className="toolbar">
        <button className="btn primary" onClick={() => setShowModal(true)}>
          <Plus size={16} /> 新增切片
        </button>
        <span style={{ color: 'var(--text-sub)' }}>共 {total} 个切片</span>
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
            placeholder="搜索切片 ID"
          />
        </div>
      </div>

      {chunks.length === 0 ? (
        <div className="empty">
          <p>暂无切片</p>
          <p>请先上传文档或手动添加切片</p>
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>切片 ID</th>
              <th>标题</th>
              <th>内容预览</th>
              <th>来源文件</th>
              <th>字节数</th>
              <th>更新时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {chunks.map((c) => (
              <tr key={c.id}>
                <td style={{ fontSize: 12, color: 'var(--text-subtle)' }}>#{c.index + 1}</td>
                <td>
                  <strong>{c.title || '—'} </strong>
                </td>
                <td
                  style={{
                    maxWidth: 300,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    color: 'var(--text-sub)',
                  }}
                >
                  {c.contentPreview}
                </td>
                <td style={{ fontSize: 12 }}>{c.sourceFile}</td>
                <td>{c.tokenCount}</td>
                <td style={{ fontSize: 12, color: 'var(--text-subtle)' }}>{c.updatedAt}</td>
                <td>
                  <button
                    className="act-btn"
                    onClick={() => {
                      setEditingChunk(c);
                      setShowModal(true);
                    }}
                  >
                    <Pencil size={14} /> 编辑
                  </button>
                  <button
                    className="act-btn danger"
                    style={{ marginLeft: 6 }}
                    onClick={() => handleDelete(c.id)}
                  >
                    <Trash2 size={14} /> 删除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {pages > 1 && (
        <div className="toolbar" style={{ marginTop: 16 }}>
          <button className="btn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            上一页
          </button>
          <span>
            第 {page} / {pages} 页
          </span>
          <button className="btn" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            下一页
          </button>
        </div>
      )}

      {showModal && (
        <ChunkModal
          chunk={editingChunk}
          kbId={kbId}
          onClose={() => {
            setShowModal(false);
            setEditingChunk(null);
          }}
          onSave={editingChunk ? handleUpdate : handleCreate}
        />
      )}
    </div>
  );
}
