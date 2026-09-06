import { useState, useEffect } from 'react';
import { App, Button, Modal } from 'antd';
import { kbApi } from '../../services/api';
import { useKbStore } from '../../stores/kb-store';
import type { KbListItem } from '../../types';

export default function EditKBModal({
  onClose,
  kb,
}: {
  onClose: () => void;
  kb?: KbListItem | null;
}) {
  const { message } = App.useApp();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const fetch = useKbStore((s) => s.fetch);

  useEffect(() => {
    if (kb) {
      setName(kb.name);
      setDescription(kb.description);
    }
  }, [kb]);

  const submit = async () => {
    if (!name.trim() || !kb) return;
    setSubmitting(true);
    try {
      await kbApi.update(kb.id, { name, description });
      await fetch();
      onClose();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open
      onCancel={onClose}
      title="编辑知识库"
      width={520}
      footer={[
        <Button key="cancel" onClick={onClose}>
          取消
        </Button>,
        <Button key="submit" type="primary" loading={submitting} onClick={submit}>
          确认修改
        </Button>,
      ]}
    >
      <div className="field">
        <label>
          知识库名称 <span className="required">*</span>
        </label>
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例如：学生成绩知识库"
          autoFocus
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
    </Modal>
  );
}
