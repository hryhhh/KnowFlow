import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Button, Empty, Input, Pagination, Popconfirm } from 'antd';
import PageHeader from '../../components/PageHeader';
import TopStepsBar from '../../components/TopStepsBar';
import ChunkModal from './ChunkModal';
import { chunkApi } from '../../services/api';
import type { ChunkCard } from '../../types';
import { Plus, Pencil, Trash2 } from 'lucide-react';

export default function ChunkList() {
  const { docId, kbId } = useParams();
  const [chunks, setChunks] = useState<ChunkCard[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [showModal, setShowModal] = useState(false);
  const [editingChunk, setEditingChunk] = useState<ChunkCard | null>(null);
  const pageSize = 10;

  useEffect(() => {
    if (!docId) return;
    chunkApi.byDoc(docId, pageSize, page).then((res) => {
      setChunks(res.data.data.items);
      setTotal(res.data.data.total);
    });
  }, [docId, page]);

  const refresh = () => {
    if (!docId) return;
    chunkApi.byDoc(docId, pageSize, page).then((res) => {
      setChunks(res.data.data.items);
      setTotal(res.data.data.total);
    });
  };

  const handleCreate = async (selectedDocId: string, content: string, title?: string) => {
    await chunkApi.create(selectedDocId, { content, title });
    if (selectedDocId === docId) {
      refresh();
    } else {
      setPage(1);
    }
  };

  const handleUpdate = async (_docId: string, content: string, title?: string) => {
    if (!editingChunk) return;
    await chunkApi.update(editingChunk.id, { content, title });
    refresh();
  };

  const handleDelete = async (chunkId: string) => {
    await chunkApi.remove(chunkId);
    refresh();
  };

  return (
    <div className="content">
      <PageHeader title="切片管理" />
      <TopStepsBar active={1} />

      <div className="toolbar">
        <Button type="primary" icon={<Plus size={16} />} onClick={() => setShowModal(true)}>
          新增切片
        </Button>
        <span style={{ color: 'var(--text-sub)' }}>共 {total} 个切片</span>
        <span className="spacer" />
        <Input.Search placeholder="搜索切片 ID" style={{ width: 220 }} allowClear />
      </div>

      {chunks.length === 0 ? (
        <Empty description="暂无切片" style={{ padding: '60px 0' }} />
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
                  <Popconfirm title="确定要删除这个切片吗？" onConfirm={() => handleDelete(c.id)}>
                    <Button
                      size="small"
                      danger
                      icon={<Trash2 size={14} />}
                      style={{ marginLeft: 6 }}
                    >
                      删除
                    </Button>
                  </Popconfirm>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <Pagination
        style={{ marginTop: 16, textAlign: 'right' }}
        current={page}
        pageSize={pageSize}
        total={total}
        onChange={(p) => setPage(p)}
        hideOnSinglePage
        showTotal={(t) => `共 ${t} 个切片`}
      />

      {showModal && (
        <ChunkModal
          chunk={editingChunk}
          defaultDocId={docId}
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
