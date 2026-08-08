import { useEffect, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { useParams } from "react-router-dom";
import TopStepsBar from "../../components/TopStepsBar";
import { useKbStore } from "../../stores/kb-store";
import { useChatStore } from "../../stores/chat-store";
import { apiServiceApi } from "../../services/api";
import type { ApiServiceItem } from "../../types";
import CreateServiceModal from "./CreateServiceModal";
import ApiUsagePanel from "./ApiUsagePanel";

export default function ChatPage() {
  const { kbId } = useParams();
  const current = useKbStore((s) => s.current);
  const { messages, sources, searchParams, isStreaming, send, setParams } =
    useChatStore();
  const [input, setInput] = useState("");
  const [services, setServices] = useState<ApiServiceItem[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedService, setSelectedService] = useState<ApiServiceItem | null>(
    null,
  );

  const loadServices = async () => {
    const res = await apiServiceApi.list();
    setServices(res.data.data);
  };

  useEffect(() => {
    loadServices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSubmit = () => {
    if (!kbId || !input.trim()) return;
    send(kbId, input.trim());
    setInput("");
  };

  return (
    <div className="content">
      <div className="header">知识问答 · {current?.name ?? kbId}</div>
      <TopStepsBar active={2} />

      <div className="chat">
        {/* 左：参数 */}
        <div className="params" style={panelStyle}>
          <h3 style={{ marginTop: 0 }}>📋 模型回答参数</h3>
          <p style={{ color: "var(--text-sub)", fontSize: 12 }}>
            调整检索参数，预览知识库命中效果
          </p>
          <ParamRow label="结果返回数量">
            <input
              className="input"
              type="number"
              value={searchParams.topK}
              onChange={(e) => setParams({ topK: Number(e.target.value) })}
            />
          </ParamRow>
          <ParamRow label="最低相似度">
            <input
              className="input"
              type="number"
              step="0.01"
              value={searchParams.minScore}
              onChange={(e) => setParams({ minScore: Number(e.target.value) })}
            />
          </ParamRow>
          <ParamRow label="重排模型">
            <span
              className={"toggle" + (searchParams.useReranker ? " on" : "")}
              onClick={() => setParams({ useReranker: !searchParams.useReranker })}
            />
          </ParamRow>
          <ParamRow label="Dense Weight">
            <input
              className="input"
              type="number"
              step="0.1"
              value={searchParams.denseWeight}
              onChange={(e) =>
                setParams({ denseWeight: Number(e.target.value) })
              }
            />
          </ParamRow>

          <hr style={{ border: "none", borderTop: "1px solid var(--border)", margin: "18px 0" }} />

          <h3>⚙️ 服务调用</h3>
          <p style={{ color: "var(--text-sub)", fontSize: 12 }}>
            发布当前问答参数，生成 API Key 供外部系统集成
          </p>
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <button className="btn" onClick={() => setShowCreate(true)}>
              创建服务调用
            </button>
            <button className="btn" onClick={() => setSelectedService(null)}>
              API 调用
            </button>
          </div>

          {services.length === 0 ? (
            <p style={{ fontSize: 12, color: "var(--text-sub)" }}>
              暂无服务调用，创建后可生成 API Key 并对外提供接口
            </p>
          ) : (
            services.map((s) => (
              <div
                key={s.id}
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: 10,
                  marginBottom: 8,
                  fontSize: 12,
                  cursor: "pointer",
                  background:
                    selectedService?.id === s.id ? "var(--primary-soft)" : "#fff",
                }}
                onClick={() => setSelectedService(s)}
              >
                <b>{s.serviceName}</b>
                <div style={{ color: "var(--text-sub)" }}>
                  {s.keyPrefix} · {s.callCount} 次调用
                </div>
              </div>
            ))
          )}
        </div>

        {/* 中：对话 */}
        <div className="conversation">
          <div className="messages">
            {messages.length === 0 ? (
              <div className="empty">
                💡 知识库助手
                <br />
                我可以阅读知识库的资料并使用自然语言回答你的问题
              </div>
            ) : (
              messages.map((m, i) => (
                <div key={i} className={"msg " + m.role}>
                  {m.content}
                </div>
              ))
            )}
          </div>
          <div className="chat-input">
            <input
              className="input"
              placeholder="我可以阅读知识库的资料并使用自然语言回答你的问题"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onSubmit()}
            />
            <button
              className="btn primary"
              onClick={onSubmit}
              disabled={isStreaming}
            >
              发送
            </button>
          </div>
        </div>

        {/* 右：引用来源 / API 调用 */}
        {selectedService ? (
          <ApiUsagePanel service={selectedService} />
        ) : (
          <div className="sources">
            <h3 style={{ marginTop: 0 }}>📎 引用来源</h3>
            <p style={{ color: "var(--text-sub)", fontSize: 12 }}>
              回答使用到的命中切片将显示在此
            </p>
            {sources.length === 0 ? (
              <p style={{ fontSize: 12, color: "var(--text-sub)" }}>暂无来源</p>
            ) : (
              sources.map((s, i) => (
                <div key={i} className="source-item">
                  <div>
                    <span className="score">{s.sourceFile}</span> · score{" "}
                    {s.score}
                  </div>
                  <pre>{s.content}</pre>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {showCreate && (
        <CreateServiceModal
          kbId={kbId ?? ""}
          onClose={() => setShowCreate(false)}
          onCreated={(svc) => {
            setSelectedService(svc);
            loadServices();
          }}
        />
      )}
    </div>
  );
}

const panelStyle: CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius)",
  padding: 18,
  overflow: "auto",
};

function ParamRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="param-row">
      <label>{label}</label>
      {children}
    </div>
  );
}
