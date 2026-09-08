import { useState } from 'react';
import { App, Button, Modal } from 'antd';
import { kbApi } from '../../services/api';
import { useKbStore } from '../../stores/kb-store';

export default function CreateKBModal({ onClose }: { onClose: () => void }) {
  const { message } = App.useApp();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const fetch = useKbStore((s) => s.fetch);

  const submit = async () => {
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      await kbApi.create({ name, description });
      await fetch();
      onClose();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '创建失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open
      onCancel={onClose}
      title="创建知识库"
      width={520}
      footer={[
        <Button key="cancel" onClick={onClose}>
          取消
        </Button>,
        <Button key="submit" type="primary" loading={submitting} onClick={submit}>
          确认创建
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
