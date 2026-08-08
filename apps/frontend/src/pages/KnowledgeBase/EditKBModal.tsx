import { useState, useEffect } from "react";
import { kbApi } from "../../services/api";
import { useKbStore } from "../../stores/kb-store";
import type { KbListItem } from "../../types";

export default function EditKBModal({
  onClose,
  kb,
}: {
  onClose: () => void;
  kb?: KbListItem | null;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const fetch = useKbStore((s) => s.fetch);

  useEffect(() => {
    if (kb) {
      setName(kb.name);
      setDescription(kb.description);
    }
  }, [kb]);

  const submit = async () => {
    if (!name.trim()) return;
    if (!kb) return;
    await kbApi.update(kb.id, { name, description });
    await fetch();
    onClose();
  };

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>编辑知识库</h3>
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
            确认修改
          </button>
        </div>
      </div>
    </div>
  );
}