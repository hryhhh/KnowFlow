import { useEffect, useState, useRef } from "react";
import type { ChangeEvent } from "react";
import { useParams, useNavigate } from "react-router-dom";
import TopStepsBar from "../../components/TopStepsBar";
import StatusBadge from "../../components/StatusBadge";
import { docApi } from "../../services/api";
import { useKbStore } from "../../stores/kb-store";
import type { DocListItem } from "../../types";

export default function DocumentList() {
  const { kbId } = useParams();
  const navigate = useNavigate();
  const current = useKbStore((s) => s.current);
  const [docs, setDocs] = useState<DocListItem[]>([]);
  const [search, setSearch] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    if (!kbId) return;
    const res = await docApi.list(kbId, search || undefined);
    setDocs(res.data.data);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kbId, search]);

  const fileRef = useRef<HTMLInputElement>(null);

  const onUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !kbId) return;
    setUploading(true);
    setError("");
    try {
      await docApi.upload(kbId, file);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "上传失败");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const deleteDoc = async (kbId: string, docId: string) => {
    await docApi.remove(kbId, docId);
    await load();
  };

  return (
    <div className="content">
      <div className="header">文档管理 · {current?.name ?? kbId}</div>
      <TopStepsBar active={1} /> 

      <div className="toolbar">
        <button
          className="btn primary"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? "上传中…" : "↑ 上传文档"}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.xlsx,.xls,.pdf,.docx,.doc"
          style={{ display: "none" }}
          onChange={onUpload}
        />
        <span className="spacer" />
        <input
          className="search-input"
          placeholder="搜索文件名"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {error && <div className="badge failed">{error}</div>}

      {docs.length === 0 ? (
        <div className="empty">暂无文档，上传 CSV / XLSX / PDF / Word 开始</div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>文档名称 / ID</th>
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
                <td>{d.name}</td>
                <td>
                  <StatusBadge status={d.status} />
                </td>
                <td>{d.strategy || "—"}</td>
                <td>{d.chunkCount}</td>
                <td>{d.importMethod}</td>
                <td>{d.updatedAt}</td>
                <td>
                  <a
                    onClick={() => navigate(`/knowledge-bases/${kbId}/documents/${d.id}/chunks`)}
                    style={{ cursor: "pointer" }}
                  >
                    切片详情
                  </a>&nbsp;&nbsp;
                  <a
                    onClick={() => deleteDoc(d.kbId, d.id)}
                    className="danger"
                    style={{ cursor: "pointer" }}
                  >
                    删除
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
