import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import TopStepsBar from "../../components/TopStepsBar";
import ChunkModal from "./ChunkModal";
import { chunkApi } from "../../services/api";
import type { ChunkCard } from "../../types";

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
    if (!window.confirm("确定要删除这个切片吗？")) return;
    await chunkApi.remove(chunkId);
    refresh();
  };

  const pages = Math.ceil(total / pageSize);

  return (
    <div className="content">
      <div className="header">切片管理</div>
      <TopStepsBar active={1} />

      <div className="toolbar">
        <button className="btn primary" onClick={() => setShowModal(true)}>
          + 新增切片
        </button>
        <span style={{ color: "var(--text-sub)" }}>共 {total} 个切片</span>
        <span className="spacer" />
        <input className="search-input" placeholder="搜索切片 ID" />
      </div>

      {chunks.length === 0 ? (
        <div className="empty">暂无切片</div>
      ) : (
        <div className="chunk-grid">
          {chunks.map((c) => (
            <div key={c.id} className="chunk-card">
              <div className="chunk-card-header">
                <div className="chunk-info">
                  <span className="chunk-idx">#{c.index + 1}</span>
                  <span className="chunk-title">{c.title}</span>
                </div>
                <div className="chunk-actions">
                  <button
                    className="action-btn"
                    onClick={() => {
                      setEditingChunk(c);
                      setShowModal(true);
                    }}
                    title="编辑"
                  >
                    ✏️
                  </button>
                  <button
                    className="action-btn"
                    onClick={() => handleDelete(c.id)}
                    title="删除"
                  >
                    🗑️
                  </button>
                </div>
              </div>
              <pre className="chunk-content">{c.contentPreview}</pre>
              <div className="chunk-meta">
                <span>{c.sourceFile}</span>
                <span>{c.tokenCount} 字节</span>
              </div>
              <div
                className="chunk-meta"
                style={{ marginTop: 6, color: "var(--text-sub)" }}
              >
                <span>更新于 {c.updatedAt}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {pages > 1 && (
        <div className="toolbar" style={{ marginTop: 16 }}>
          <button
            className="btn"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            上一页
          </button>
          <span>第 {page} / {pages} 页</span>
          <button
            className="btn"
            disabled={page >= pages}
            onClick={() => setPage((p) => p + 1)}
          >
            下一页
          </button>
        </div>
      )}

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