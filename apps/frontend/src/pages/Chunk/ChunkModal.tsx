import { useState, useEffect } from 'react';
import { App, Button, Modal, Select } from 'antd';
import type { ChunkCard, DocListItem } from '../../types';
import { docApi } from '../../services/api';

export default function ChunkModal({
  onClose,
  chunk,
  defaultDocId,
  kbId,
  onSave,
}: {
  onClose: () => void;
  chunk?: ChunkCard | null;
  defaultDocId?: string;
  kbId?: string;
  onSave: (docId: string, content: string, title?: string) => Promise<void>;
}) {
  const { message } = App.useApp();
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [selectedDocId, setSelectedDocId] = useState(defaultDocId ?? '');
  const [documents, setDocuments] = useState<DocListItem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const maxLength = 8000;

  useEffect(() => {
    if (chunk) {
      setTitle(chunk.title);
      setContent(chunk.contentPreview);
    } else {
      setTitle('');
      setContent('');
    }
  }, [chunk]);

  useEffect(() => {
    if (kbId) {
      docApi.list(kbId).then((res) => {
        setDocuments(res.data.data);
      });
    }
  }, [kbId]);

  const handleSubmit = async () => {
    if (!selectedDocId) {
      message.warning('请选择所属文档');
      return;
    }
    if (!content.trim()) {
      message.warning('请输入切片内容');
      return;
    }
    setSubmitting(true);
    try {
      await onSave(selectedDocId, content, title || undefined);
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open
      onCancel={onClose}
      title={chunk ? '编辑切片' : '添加切片'}
      width={560}
      footer={[
        <Button key="cancel" onClick={onClose}>
          取消
        </Button>,
        <Button key="submit" type="primary" loading={submitting} onClick={handleSubmit}>
          {chunk ? '确认修改' : '添加'}
        </Button>,
      ]}
    >
      <div className="field">
        <label>
          所属文档 <span className="required">*</span>
        </label>
        <Select
          style={{ width: '100%' }}
          placeholder="请选择文档"
          value={selectedDocId || undefined}
          onChange={(v) => setSelectedDocId(v)}
          options={[...documents.map((doc) => ({ value: doc.id, label: doc.name }))]}
        />
      </div>

      <div className="field">
        <label>切片标题</label>
        <input
          className="input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="输入切片标题（选填）"
        />
      </div>

      <div className="field">
        <label>
          切片内容 <span className="required">*</span>
        </label>
        <div className="textarea-wrapper">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value.slice(0, maxLength))}
            placeholder="请输入切片内容"
            maxLength={maxLength}
            className="chunk-textarea"
          />
          <span className="char-count">
            {content.length}/{maxLength}
          </span>
        </div>
      </div>
    </Modal>
  );
}
