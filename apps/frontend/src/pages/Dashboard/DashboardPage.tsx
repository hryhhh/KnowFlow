import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import PageHeader from "../../components/PageHeader";
import { dashboardApi, apiServiceApi } from "../../services/api";
import { useKbStore } from "../../stores/kb-store";
import type { DashboardSummary, TrendPoint, ActivityItem, ApiServiceItem } from "../../types";
import { Area, Pie } from "@ant-design/charts";
import {
  Database,
  FileText,
  Star,
  Plug,
  Activity,
  HardDrive,
  AlertCircle,
  PieChart,
  Upload,
} from "lucide-react";

const CHART_COLORS = ["#1677ff", "#52c41a", "#faad14", "#722ed1"];

export default function DashboardPage() {
  const navigate = useNavigate();
  const current = useKbStore((s) => s.current);
  const kbList = useKbStore((s) => s.list);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [trends, setTrends] = useState<TrendPoint[]>([]);
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [services, setServices] = useState<ApiServiceItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      dashboardApi.summary(),
      dashboardApi.trends(),
      dashboardApi.activities(),
      apiServiceApi.list(),
    ])
      .then(([sumRes, trendRes, actRes, svcRes]) => {
        setSummary(sumRes.data.data);
        setTrends(trendRes.data?.data ?? []);
        setActivities(actRes.data.data?.items ?? []);
        setServices(svcRes.data.data ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Melt trends for multi-line Area chart
  const areaData = (trends ?? []).flatMap((t) => [
    { date: t.date, type: "API 调用", value: t.apiCalls },
    { date: t.date, type: "检索调用", value: t.retrievalCalls },
    { date: t.date, type: "问答调用", value: t.chatCalls },
  ]);
  const areaConfig = {
    data: areaData,
    autoFit: true,
    height: 240,
    xField: "date",
    yField: "value",
    seriesField: "type",
    smooth: true,
    point: { size: 3 },
    legend: { position: "top" as const },
    color: CHART_COLORS,
    line: { size: 1.5 },
  };
  const pieData = [
    { type: "API 调用", value: trends.reduce((s, t) => s + t.apiCalls, 0) },
    { type: "检索调用", value: trends.reduce((s, t) => s + t.retrievalCalls, 0) },
    { type: "问答调用", value: trends.reduce((s, t) => s + t.chatCalls, 0) },
  ];
  const pieConfig = {
    data: pieData,
    autoFit: true,
    height: 220,
    angleField: "value",
    colorField: "type",
    radius: 0.85,
    label: {
      position: "outside",
      formatter: (_: Record<string, unknown>, datum: Record<string, number>) =>
        `${((datum.value / pieData.reduce((s, i) => s + i.value, 0)) * 100).toFixed(0)}%`,
    },
    interactions: [{ type: "element-active" }],
    color: CHART_COLORS,
  };

  const KPI = [
    { title: "知识库", value: summary?.knowledgeBaseCount ?? 0, color: "#1677ff", sub: "个", icon: Database },
    { title: "文档总数", value: summary?.documentCount ?? 0, color: "#52c41a", sub: "篇", icon: FileText },
    { title: "切片总数", value: summary?.chunkCount ?? 0, color: "#faad14", sub: "片", icon: Activity },
    { title: "处理中", value: summary?.processingCount ?? 0, color: "#13c2c2", sub: "篇", icon: Upload },
    { title: "失败数", value: summary?.errorCount ?? 0, color: "#ff4d4f", sub: "个", icon: AlertCircle },
    { title: "存储用量", value: summary?.storageUsage ?? "—", color: "#722ed1", sub: "", icon: HardDrive },
  ];

  const statusColor: Record<string, string> = {
    success: "#52c41a",
    processing: "#1677ff",
    failed: "#ff4d4f",
    pending: "#86909c",
  };

  const cardStyle: React.CSSProperties = {
    background: "var(--panel)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-lg)",
    padding: 20,
    boxShadow: "var(--shadow-sm)",
  };

  if (loading) {
    return (
      <div className="content">
        <PageHeader title="工作台" />
        <div className="empty"><p>加载中…</p></div>
      </div>
    );
  }

  return (
    <div className="content">
      <PageHeader title="工作台" />

      {/* ── KPI 卡片区 ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 16, marginBottom: 24 }}>
        {KPI.map((k) => (
          <div key={k.title} style={cardStyle}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <k.icon size={16} style={{ color: k.color, flexShrink: 0 }} />
              <span style={{ fontSize: 12, color: "var(--text-sub)", flex: 1 }}>{k.title}</span>
            </div>
            <div style={{ fontSize: 24, fontWeight: 700, color: k.color, lineHeight: 1 }}>
              {k.value}
              {k.sub && (
                <span style={{ fontSize: 13, fontWeight: 400, color: "var(--text-sub)", marginLeft: 4 }}>
                  {k.sub}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* ── 图表区 ── */}
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16, marginBottom: 24 }}>
        {/* 调用趋势 */}
        <div style={cardStyle}>
          <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
            <Activity size={16} /> 近7日调用趋势
          </h3>
          <Area {...areaConfig} />
        </div>
        {/* 调用占比 */}
        <div style={cardStyle}>
          <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
            <PieChart size={16} /> 调用占比
          </h3>
          <Pie {...pieConfig} />
        </div>
      </div>

      {/* ── 知识库列表 + API 服务 ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
        {/* 最近知识库 */}
        <div style={cardStyle}>
          <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
            <Database size={16} /> 最近知识库
          </h3>
          {kbList.length === 0 ? (
            <div className="empty" style={{ padding: "30px 0" }}><p>暂无知识库</p></div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {kbList.slice(0, 5).map((kb) => (
                <div
                  key={kb.id}
                  onClick={() => {
                    useKbStore.getState().select(kb);
                    navigate(`/knowledge-bases/${kb.id}/documents`);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "10px 12px",
                    background: "var(--bg)",
                    borderRadius: "var(--radius)",
                    cursor: "pointer",
                    transition: "background 0.15s",
                  }}
                  onMouseEnter={(e) => ((e.currentTarget as HTMLDivElement).style.background = "#e6f4ff")}
                  onMouseLeave={(e) => ((e.currentTarget as HTMLDivElement).style.background = "var(--bg)")}
                >
                  <Database size={16} style={{ color: "var(--text-subtle)", flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, color: "var(--text)", display: "flex", alignItems: "center", gap: 6 }}>
                      {kb.name}
                      {kb.isDefault && (
                        <Star size={12} fill="#faad14" stroke="#faad14" style={{ flexShrink: 0 }} />
                      )}
                      {current?.id === kb.id && (
                        <span style={{ fontSize: 11, color: "var(--primary)", fontWeight: 500 }}>当前</span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-subtle)", marginTop: 2 }}>
                      {kb.documentCount} 文档 · {kb.chunkCount} 切片
                    </div>
                  </div>
                  <span style={{ fontSize: 11, color: "var(--text-subtle)" }}>{kb.createdAt?.slice(0, 10)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* API 服务调用统计 */}
        <div style={cardStyle}>
          <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
            <Plug size={16} /> API 服务调用
          </h3>
          {services.length === 0 ? (
            <div className="empty" style={{ padding: "30px 0" }}><p>暂无 API 服务</p></div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {services.map((svc) => (
                <div
                  key={svc.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "10px 12px",
                    background: "var(--bg)",
                    borderRadius: "var(--radius)",
                  }}
                >
                  <Plug size={16} style={{ color: "var(--text-subtle)", flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {svc.serviceName}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-subtle)", marginTop: 2 }}>
                      {svc.keyPrefix}… · 更新于 {svc.updatedAt?.slice(0, 10)}
                    </div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ fontSize: 16, fontWeight: 700, color: "#1677ff" }}>{svc.callCount}</div>
                    <div style={{ fontSize: 11, color: "var(--text-subtle)" }}>次调用</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── 最近活动 ── */}
      <div style={cardStyle}>
        <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
          <Activity size={16} /> 最近活动
        </h3>
        {activities.length === 0 ? (
          <div className="empty"><p>暂无活动记录</p></div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {activities.map((a) => (
              <div
                key={a.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "10px 12px",
                  background: "var(--bg)",
                  borderRadius: "var(--radius)",
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: statusColor[a.status] ?? "#86909c",
                    flexShrink: 0,
                  }}
                />
                <span style={{ flex: 1, fontSize: 13 }}>{a.title}</span>
                <span style={{ fontSize: 11, color: "var(--text-subtle)" }}>{a.agent}</span>
                <span style={{ fontSize: 11, color: "var(--text-subtle)" }}>
                  {new Date(a.createdAt).toLocaleString("zh-CN")}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
