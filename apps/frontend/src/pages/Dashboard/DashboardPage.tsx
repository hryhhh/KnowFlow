import { useEffect, useState } from "react";
import PageHeader from "../../components/PageHeader";
import { dashboardApi } from "../../services/api";
import type { DashboardSummary, TrendPoint, ActivityItem } from "../../types";
import { Area, Pie } from "@ant-design/charts";
const CHART_COLORS = ["#1677ff", "#52c41a", "#faad14", "#722ed1"];
export default function DashboardPage() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [trends, setTrends] = useState<TrendPoint[]>([]);
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    Promise.all([
      dashboardApi.summary(),
      dashboardApi.trends(),
      dashboardApi.activities(),
    ])
      .then(([sumRes, trendRes, actRes]) => {
        setSummary(sumRes.data.data);
        setTrends(trendRes.data.data.series);
        setActivities(actRes.data.data.items);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  // Melt trends for multi-line Area chart
  const areaData = trends.flatMap((t) => [
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
    label: { type: "outer", content: "{percentage}" },
    interactions: [{ type: "element-active" }],
    color: CHART_COLORS,
  };
  const KPI = [
    { title: "知识库", value: summary?.knowledgeBaseCount ?? 0, color: "#1677ff", sub: "个" },
    { title: "文档总数", value: summary?.documentCount ?? 0, color: "#52c41a", sub: "篇" },
    { title: "切片总数", value: summary?.chunkCount ?? 0, color: "#faad14", sub: "片" },
    { title: "处理中", value: summary?.processingCount ?? 0, color: "#13c2c2", sub: "篇" },
  ];
  const statusColor: Record<string, string> = {
    success: "#52c41a",
    processing: "#1677ff",
    failed: "#ff4d4f",
    pending: "#86909c",
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
      {/* KPI 卡片区 */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 0, marginBottom: 24 }}>
        {KPI.map((k) => (
          <div
            key={k.title}
            style={{
              background: "var(--panel)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-lg)",
              padding: "20px 24px",
              boxShadow: "var(--shadow-sm)",
              display: "flex",
              alignItems: "center",
              gap: 0,
            }}
          >
            <div>
              <div style={{ fontSize: 12, color: "var(--text-sub)", marginBottom: 4 }}>{k.title}</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: k.color, lineHeight: 1 }}>
                {k.value}
                <span style={{ fontSize: 13, fontWeight: 400, color: "var(--text-sub)", marginLeft: 4 }}>{k.sub}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
      {/* 图表区 */}
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 0, marginBottom: 24 }}>
        {/* 调用趋势 */}
        <div
          style={{
            background: "var(--panel)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-lg)",
            padding: 20,
            boxShadow: "var(--shadow-sm)",
          }}
        >
          <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 600 }}>近7日调用趋势</h3>
          <Area {...areaConfig} />
        </div>
        {/* 调用占比 */}
        <div
          style={{
            background: "var(--panel)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-lg)",
            padding: 20,
            boxShadow: "var(--shadow-sm)",
          }}
        >
          <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 600 }}>调用占比</h3>
          <Pie {...pieConfig} />
        </div>
      </div>
      {/* 最近活动 */}
      <div
        style={{
          background: "var(--panel)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-lg)",
          padding: 20,
          boxShadow: "var(--shadow-sm)",
        }}
      >
        <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 600 }}>最近活动</h3>
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
