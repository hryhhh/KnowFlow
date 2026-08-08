import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import PageHeader from "../../components/PageHeader";
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

  const handleView = (kb: (typeof list)[0]) => {
    select(kb);
    navigate(`/knowledge-bases/${kb.id}/documents`);
  };

  return (
    <div className="content">
      <PageHeader title="知识库管理" />
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
        <div className="empty">
          <p>暂无知识库</p>
          <p>点击「创建知识库」开始</p>
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>知识库名称</th>
              <th>描述</th>
              <th>类型</th>
              <th>文档数</th>
              <th>切片数</th>
              <th>更新时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {list.map((kb) => (
              <tr key={kb.id}>
                <td>
                  <strong style={{ color: "var(--primary)" }}>{kb.name}</strong>
                </td>
                <td style={{ color: "var(--text-sub)", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {kb.description || "—"}
                </td>
                <td>
                  <span className="badge success" style={{ fontSize: 11 }}>
                    {kb.type === "free" ? "免费版" : kb.type}
                  </span>
                </td>
                <td>{kb.documentCount}</td>
                <td>{kb.chunkCount}</td>
                <td style={{ color: "var(--text-subtle)", fontSize: 12 }}>{kb.createdAt?.slice(0, 10) || "—"}</td>
                <td>
                  <a style={{ cursor: "pointer", marginRight: 8 }} onClick={() => handleView(kb)}>
                    进入
                  </a>
                  <a style={{ cursor: "pointer", marginRight: 8 }} onClick={() => { select(kb); setShowEditModal(true); }}>
                    编辑
                  </a>
                  <a
                    className="danger"
                    style={{ cursor: "pointer" }}
                    onClick={() => handleDelete(kb.id)}
                  >
                    删除
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
