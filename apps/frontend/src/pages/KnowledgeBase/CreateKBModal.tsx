import { useState } from "react";
import { kbApi } from "../../services/api";
import { useKbStore } from "../../stores/kb-store";

export default function CreateKBModal({
  onClose,
}: {
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const fetch = useKbStore((s) => s.fetch);

  const submit = async () => {
    if (!name.trim()) return;
    await kbApi.create({ name, description });
    await fetch();
    onClose();
  };

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>创建知识库</h3>
        <div className="field">
          <label>知识库名称 *</label>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：学生成绩知识库"
          />
        </div>
        <div className="field">
          <label>描述</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="简要描述该知识库的用途"
          />
        </div>
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn primary" onClick={submit}>
            确认创建
          </button>
        </div>
      </div>
    </div>
  );
}
