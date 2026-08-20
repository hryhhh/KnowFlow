import { useState, useEffect } from 'react';
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
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [selectedDocId, setSelectedDocId] = useState(defaultDocId ?? '');
  const [documents, setDocuments] = useState<DocListItem[]>([]);
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
      alert('请选择所属文档');
      return;
    }
    if (!content.trim()) {
      alert('请输入切片内容');
      return;
    }
    await onSave(selectedDocId, content, title || undefined);
    onClose();
  };

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{chunk ? '编辑切片' : '添加切片'}</h3>
          <button className="modal-close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="field">
          <label>
            所属文档 <span className="required">*</span>
          </label>
          <select
            className="select"
            value={selectedDocId}
            onChange={(e) => setSelectedDocId(e.target.value)}
          >
            <option value="">请选择文档</option>
            {documents.map((doc) => (
              <option key={doc.id} value={doc.id}>
                {doc.name}
              </option>
            ))}
          </select>
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

        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn primary" onClick={handleSubmit}>
            {chunk ? '确认修改' : '添加'}
          </button>
        </div>
      </div>
    </div>
  );
}
