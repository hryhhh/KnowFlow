import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Button, Input, Popconfirm, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
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

  const columns: ColumnsType<ChunkCard> = [
    {
      title: '切片 ID',
      key: 'index',
      width: 80,
      render: (_, c) => (
        <span style={{ fontSize: 12, color: 'var(--text-subtle)' }}>#{c.index + 1}</span>
      ),
    },
    {
      title: '标题',
      dataIndex: 'title',
      width: 160,
      ellipsis: true,
      render: (t: string) => <strong>{t || '—'}</strong>,
    },
    { title: '内容预览', dataIndex: 'contentPreview', ellipsis: true },
    {
      title: '来源文件',
      dataIndex: 'sourceFile',
      ellipsis: true,
      render: (v: string) => <span style={{ fontSize: 12 }}>{v}</span>,
    },
    { title: '字节数', dataIndex: 'tokenCount', width: 90 },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      width: 150,
      render: (v: string) => <span style={{ fontSize: 12, color: 'var(--text-subtle)' }}>{v}</span>,
    },
    {
      title: '操作',
      key: 'actions',
      width: 170,
      render: (_, c) => (
        <>
          <Button
            size="small"
            icon={<Pencil size={14} />}
            onClick={() => {
              setEditingChunk(c);
              setShowModal(true);
            }}
          >
            编辑
          </Button>
          <Popconfirm title="确定要删除这个切片吗？" onConfirm={() => handleDelete(c.id)}>
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

      <Table
        rowKey="id"
        size="small"
        columns={columns}
        dataSource={chunks}
        locale={{ emptyText: '暂无切片' }}
        pagination={{
          current: page,
          pageSize,
          total,
          onChange: (p) => setPage(p),
          hideOnSinglePage: true,
          showTotal: (t) => `共 ${t} 个切片`,
        }}
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
