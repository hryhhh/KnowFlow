import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import TopStepsBar from "../../components/TopStepsBar";
import CreateKBModal from "./CreateKBModal";
import EditKBModal from "./EditKBModal";
import { useKbStore } from "../../stores/kb-store";
import { kbApi } from "../../services/api";

export default function KnowledgeBaseList() {
  const { list, loading, fetch, select, current } = useKbStore();
  const [search, setSearch] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    fetch(search);
  }, [fetch, search]);

  const handleDelete = async (id: string) => {
    if (!window.confirm("确定要删除这个知识库吗？")) return;
    await kbApi.remove(id);
    await fetch();
  };

  return (
    <div className="content">
      <div className="header">知识库</div>
      <TopStepsBar active={0} />

      <div className="toolbar">
        <button className="btn primary" onClick={() => setShowModal(true)}>
          + 创建知识库
        </button>
        <span style={{ color: "var(--text-sub)" }}>
          共 {list.length} 个知识库
        </span>
        <span className="spacer" />
        <input
          className="search-input"
          placeholder="搜索知识库名称"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {loading ? (
        <div className="empty">加载中…</div>
      ) : list.length === 0 ? (
        <div className="empty">暂无知识库，点击「创建知识库」开始</div>
      ) : (
        <div className="kb-grid">
          {list.map((kb) => (
            <div
              key={kb.id}
              className="kb-card"
              onClick={() => {
                select(kb);
                navigate(`/knowledge-bases/${kb.id}/documents`);
              }}
            >
              <div className="kb-card-header">
                <span className="kb-icon">🗄️</span>
                <div className="kb-actions">
                  <button 
                    className="action-btn" 
                    onClick={(e) => {
                      e.stopPropagation();
                      select(kb);
                      setShowEditModal(true);
                    }}
                    title="编辑"
                  >
                    ✏️
                  </button>
                  <button 
                    className="action-btn" 
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(kb.id);
                    }}
                    title="删除"
                  >
                    🗑️
                  </button>
                </div>
              </div>
              <h3>{kb.name}</h3>
              <p>{kb.description || "（暂无描述）"}</p>
              <div className="meta">
                <span>{kb.type === "free" ? "免费版" : kb.type}</span>
                <span>{kb.documentCount} 个文档</span>
                <span>{kb.chunkCount} 个切片</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && <CreateKBModal onClose={() => setShowModal(false)} />}
      {showEditModal && (
        <EditKBModal 
          kb={current} 
          onClose={() => setShowEditModal(false)} 
        />
      )}
    </div>
  );
}
