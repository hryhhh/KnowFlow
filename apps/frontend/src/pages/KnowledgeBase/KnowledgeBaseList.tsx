import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Button,
  Card,
  Col,
  Input,
  Popconfirm,
  Row,
  Space,
  Steps,
  Tag,
} from "antd";
import {
  DatabaseOutlined,
  FileTextOutlined,
  SearchOutlined,
  StarOutlined,
} from "@ant-design/icons";
import { kbApi } from "../../services/api";
import { useKbStore } from "../../stores/kb-store";
import type { KbListItem } from "../../types";
import CreateKBModal from "./CreateKBModal";
import EditKBModal from "./EditKBModal";

const STEPS = [
  { title: "创建知识库", description: "按业务场景创建知识库" },
  { title: "上传文档", description: "文档上传、解析与切片" },
  { title: "检索问答", description: "调试阈值、切片命中与答案引用" },
  { title: "API 调用", description: "通过 SSE 接口集成到真实业务流程" },
];

function KBCard({
  kb,
  defaultKbId,
  onEnter,
  onEdit,
  onDelete,
  onSetDefault,
}: {
  kb: KbListItem;
  defaultKbId: string | null;
  onEnter: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onSetDefault: () => void;
}) {
  return (
    <Card
      style={{
        borderRadius: 12,
        height: "100%",
        display: "flex",
        flexDirection: "column",
        border: "1px solid #f0f0f0",
        transition: "box-shadow 0.2s, border-color 0.2s",
      }}

    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          marginBottom: 12,
        }}
      >
        <Space>
          <DatabaseOutlined style={{ fontSize: 24, color: "#1677ff" }} />
          <span
            style={{
              fontSize: 15,
              fontWeight: 600,
              color: "#1d2129",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              maxWidth: 180,
            }}
          >
            {kb.name}
          </span>
          <Tag color="green">免费版</Tag>
        </Space>
        <button
          type="button"
          onClick={() => onSetDefault()}
          title={kb.isDefault ? "取消设为默认" : "设为默认知识库"}
          style={{
            background: kb.isDefault ? "#fffbe6" : "transparent",
            border: "1px solid " + (kb.isDefault ? "#faad14" : "#d9d9d9"),
            cursor: "pointer",
            fontSize: 16,
            color: kb.isDefault ? "#faad14" : "#86909c",
            padding: "4px 8px",
            borderRadius: 6,
            lineHeight: 1,
            flexShrink: 0,
            transition: "all 0.2s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = "#faad14";
            e.currentTarget.style.color = "#faad14";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = kb.isDefault ? "#faad14" : "#d9d9d9";
            e.currentTarget.style.color = kb.isDefault ? "#faad14" : "#86909c";
          }}
        >
          <StarOutlined /> {kb.isDefault ? "已默认" : "设默认"}
        </button>
      </div>

      {/* Body */}
      <div
        style={{
          background: "#f5f7fa",
          borderRadius: 8,
          padding: "10px 14px",
          marginBottom: 12,
        }}
      >
        <Space size={20}>
          <Space size={6}>
            <FileTextOutlined style={{ color: "#1677ff" }} />
            <span style={{ color: "#4e5969" }}>
              {kb.documentCount} <span style={{ color: "#86909c" }}>文档</span>
            </span>
          </Space>
          <Space size={6}>
            <SearchOutlined style={{ color: "#1677ff" }} />
            <span style={{ color: "#4e5969" }}>
              {kb.chunkCount} <span style={{ color: "#86909c" }}>切片</span>
            </span>
          </Space>
        </Space>
      </div>

      {kb.description && (
        <div
          style={{
            color: "#4e5969",
            fontSize: 13,
            lineHeight: 1.5,
            marginBottom: 8,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {kb.description}
        </div>
      )}

      <span style={{ color: "#86909c", fontSize: 12 }}>
        更新于 {kb.createdAt?.slice(0, 10) || "—"}
      </span>

      {/* Footer */}
      <div
        style={{
          display: "flex",
          marginTop: "auto",
          paddingTop: 14,
          borderTop: "1px solid #f0f0f0",
          gap: 8,
        }}
      >
        <Button
          type="primary"
          style={{ flex: 1, borderRadius: 8, background: "#1677ff" }}
          onClick={onEnter}
        >
          进入
        </Button>
        <Button
          style={{ flex: 1, borderRadius: 8 }}
          onClick={onEdit}
        >
          编辑
        </Button>
        <Popconfirm
          title="确定要删除这个知识库吗？"
          description="删除后将不可恢复"
          okText="删除"
          cancelText="取消"
          okButtonProps={{ danger: true }}
          onConfirm={onDelete}
        >
          <Button
            danger
            style={{ flex: 1, borderRadius: 8 }}
          >
            删除
          </Button>
        </Popconfirm>
      </div>
    </Card>
  );
}

export default function KnowledgeBaseList() {
  const { list, loading, fetch, select, current, defaultKbId, setDefaultKb } = useKbStore();
  const [search, setSearch] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [viewMode, setViewMode] = useState<"card" | "list">("card");
  const navigate = useNavigate();

  useEffect(() => {
    fetch(search);
  }, [fetch, search]);

  const handleDelete = async (id: string) => {
    await kbApi.remove(id);
    await fetch();
  };

  const handleView = (kb: KbListItem) => {
    select(kb);
    navigate(`/knowledge-bases/${kb.id}/documents`);
  };

  const openEdit = (kb: KbListItem) => {
    select(kb);
    setShowEditModal(true);
  };

  return (
    <div className="content">
      {/* Steps */}
      <Steps
        current={0}
        items={STEPS}
        style={{ marginBottom: 24 }}
        size="small"
      />

      {/* Toolbar */}
      <Space style={{ marginBottom: 20, width: "100%" }}>
        <Button
          type="primary"
          style={{ background: "#1677ff", borderRadius: 8 }}
          onClick={() => setShowModal(true)}
        >
          + 创建知识库
        </Button>
        <span style={{ color: "#86909c", fontSize: 13 }}>
          共 {list.length} 个知识库
        </span>
        <Space style={{ flex: 1 }} />
        <Input
          prefix={<SearchOutlined style={{ color: "#86909c" }} />}
          placeholder="搜索知识库名称"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: 220, borderRadius: 8 }}
        />
        <Button.Group style={{ borderRadius: 8 }}>
          <Button
            type={viewMode === "card" ? "primary" : "default"}
            style={{
              borderRadius: "8px 0 0 8px",
              background: viewMode === "card" ? "#1677ff" : undefined,
            }}
            onClick={() => setViewMode("card")}
          >
            卡片
          </Button>
          <Button
            type={viewMode === "list" ? "primary" : "default"}
            style={{
              borderRadius: "0 8px 8px 0",
              background: viewMode === "list" ? "#1677ff" : undefined,
            }}
            onClick={() => setViewMode("list")}
          >
            列表
          </Button>
        </Button.Group>
      </Space>

      {/* Content */}
      {loading ? (
        <div style={{ textAlign: "center", padding: "60px 0", color: "#86909c" }}>
          加载中…
        </div>
      ) : list.length === 0 ? (
        <div
          style={{
            textAlign: "center",
            padding: "60px 0",
            color: "#86909c",
            background: "#fff",
            borderRadius: 12,
            border: "1px dashed #e5e6eb",
          }}
        >
          <p style={{ margin: 0, fontSize: 14 }}>暂无知识库</p>
          <p style={{ margin: "8px 0 0", fontSize: 13, color: "#86909c" }}>
            点击「创建知识库」开始
          </p>
        </div>
      ) : viewMode === "card" ? (
        <Row gutter={[16, 16]}>
          {list.map((kb) => (
            <Col key={kb.id} xs={24} sm={12} lg={8} xl={6}>
              <KBCard
                kb={kb}
                defaultKbId={defaultKbId}
                onEnter={() => handleView(kb)}
                onEdit={() => openEdit(kb)}
                onDelete={() => handleDelete(kb.id)}
                onSetDefault={() =>
                  setDefaultKb(defaultKbId === kb.id ? "" : kb.id)
                }
              />
            </Col>
          ))}
        </Row>
      ) : (
        <Card bordered={false} style={{ borderRadius: 12 }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 14,
            }}
          >
            <thead>
              <tr
                style={{
                  background: "#fafafa",
                  borderBottom: "1px solid #f0f0f0",
                }}
              >
                {["知识库名称", "描述", "类型", "文档数", "切片数", "更新时间", "操作"].map(
                  (h) => (
                    <th
                      key={h}
                      style={{
                        padding: "12px 16px",
                        textAlign: "left",
                        fontWeight: 600,
                        fontSize: 13,
                        color: "#4e5969",
                      }}
                    >
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {list.map((kb) => (
                <tr
                  key={kb.id}
                  style={{ borderBottom: "1px solid #f0f0f0", transition: "background 0.15s" }}
                  onMouseEnter={(e) =>
                    ((e.currentTarget as HTMLTableRowElement).style.background = "#fafafa")
                  }
                  onMouseLeave={(e) =>
                    ((e.currentTarget as HTMLTableRowElement).style.background = "")
                  }
                >
                  <td style={{ padding: "12px 16px" }}>
                    <strong style={{ color: "#1677ff" }}>
                      {kb.name}
                      {defaultKbId === kb.id && (
                        <span
                          style={{
                            marginLeft: 6,
                            fontSize: 11,
                            color: "#faad14",
                            fontWeight: 500,
                          }}
                        >
                          ★ 默认
                        </span>
                      )}
                    </strong>
                  </td>
                  <td
                    style={{
                      padding: "12px 16px",
                      color: "#4e5969",
                      maxWidth: 200,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {kb.description || "—"}
                  </td>
                  <td style={{ padding: "12px 16px" }}>
                    <Tag color="green" style={{ borderRadius: 12, fontSize: 12 }}>
                      {kb.type === "free" ? "免费版" : kb.type}
                    </Tag>
                  </td>
                  <td style={{ padding: "12px 16px" }}>{kb.documentCount}</td>
                  <td style={{ padding: "12px 16px" }}>{kb.chunkCount}</td>
                  <td
                    style={{
                      padding: "12px 16px",
                      color: "#86909c",
                      fontSize: 12,
                    }}
                  >
                    {kb.createdAt?.slice(0, 10) || "—"}
                  </td>
                  <td style={{ padding: "12px 16px" }}>
                    <Space size={6}>
                      <Button
                        size="small"
                        type="primary"
                        style={{ background: "#1677ff", borderRadius: 6 }}
                        onClick={() => handleView(kb)}
                      >
                        进入
                      </Button>
                      <Button
                        size="small"
                        style={{ borderRadius: 6 }}
                        onClick={() => openEdit(kb)}
                      >
                        编辑
                      </Button>
                      <Popconfirm
                        title="确定要删除这个知识库吗？"
                        description="删除后将不可恢复"
                        okText="删除"
                        cancelText="取消"
                        okButtonProps={{ danger: true }}
                        onConfirm={() => handleDelete(kb.id)}
                      >
                        <Button size="small" danger style={{ borderRadius: 6 }}>
                          删除
                        </Button>
                      </Popconfirm>
                    </Space>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
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
