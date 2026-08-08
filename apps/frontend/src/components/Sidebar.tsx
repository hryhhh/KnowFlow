import { NavLink } from "react-router-dom";
import { useKbStore } from "../stores/kb-store";

export default function Sidebar() {
  const current = useKbStore((s) => s.current);

  const base = current ? `/knowledge-bases/${current.id}` : null;

  const items = [
    { to: "/knowledge-bases", label: "知识库管理", icon: "📚" },
    {
      to: base ? `${base}/documents` : "#",
      label: "文档管理",
      disabled: !base,
    },
    {
      to: base ? `${base}/chunks` : "#",
      label: "切片管理",
      disabled: !base,
    },
    {
      to: base ? `${base}/retrieval` : "#",
      label: "知识检索",
      disabled: !base,
    },
    {
      to: base ? `${base}/chat` : "#",
      label: "知识问答",
      disabled: !base,
    },
  ];

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        Knowledge AI
        <span>LangChain.js 实践台</span>
      </div>
      <nav className="sidebar-nav">
        {items.map((it) => (
          <NavLink
            key={it.label}
            to={it.disabled ? "#" : it.to}
            className={({ isActive }) =>
              "nav-item" + (isActive && !it.disabled ? " active" : "") + (it.disabled ? " disabled" : "")
            }
            onClick={(e) => {
              if (it.disabled) e.preventDefault();
            }}
          >
            <span>{it.icon}</span>
            <span>{it.label}</span>
          </NavLink>
        ))}
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
