import { NavLink } from "react-router-dom";
import { useKbStore } from "../stores/kb-store";
import {
  LayoutDashboard,
  Database,
  FileText,
  Layers,
  Search,
  MessageSquare,
} from "lucide-react";

const NAV_ITEMS = [
  { to: "/dashboard", label: "工作台", icon: LayoutDashboard },
  { to: "/knowledge-bases", label: "知识库管理", icon: Database },
  { to: "documents", label: "文档管理", icon: FileText },
  { to: "chunks", label: "切片管理", icon: Layers },
  { to: "retrieval", label: "知识检索", icon: Search },
  { to: "chat", label: "知识问答", icon: MessageSquare },
];

export default function Sidebar() {
  const current = useKbStore((s) => s.current);

  const base = current ? `/knowledge-bases/${current.id}` : null;

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        KnowBase X
        <span>LangChain.js 实践台</span>
      </div>
      <nav className="sidebar-nav">
        {NAV_ITEMS.map((it) => {
          const to = it.to.startsWith("/") ? it.to : (base ? `${base}/${it.to}` : "#");
          const disabled = !base;
          return (
            <NavLink
              key={it.label}
              to={disabled ? "#" : to}
              className={({ isActive }) =>
                "nav-item" + (isActive && !disabled ? " active" : "") + (disabled ? " disabled" : "")
              }
              onClick={(e) => {
                if (disabled) e.preventDefault();
              }}
            >
              <it.icon size={16} />
              <span>{it.label}</span>
            </NavLink>
          );
        })}
      </nav>
      <div className="sidebar-stats">
        <div>
          当前知识库：<b style={{ color: "#fff" }}>{current ? current.name : "未选择"}</b>
        </div>
        {current && (
          <>
            <div>文档数：{current.documentCount}</div>
            <div>切片数：{current.chunkCount}</div>
          </>
        )}
      </div>
    </aside>
  );
}
