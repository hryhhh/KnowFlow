import { useState } from 'react';
import { Alert, App, Button, Modal } from 'antd';
import { apiServiceApi } from '../../services/api';
import type { ApiServiceItem, CreateApiResult } from '../../types';

export default function CreateServiceModal({
  kbId,
  onClose,
  onCreated,
}: {
  kbId: string;
  onClose: () => void;
  onCreated: (svc: ApiServiceItem) => void;
}) {
  const { message } = App.useApp();
  const [serviceName, setServiceName] = useState('');
  const [description, setDescription] = useState('');
  const [result, setResult] = useState<CreateApiResult | null>(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!serviceName.trim()) return;
    setError('');
    setSubmitting(true);
    try {
      const res = await apiServiceApi.create({
        serviceName,
        description,
        kbId,
      });
      setResult(res.data.data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '创建失败';
      setError(msg);
      message.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open
      onCancel={onClose}
      title="创建服务调用"
      width={520}
      footer={
        result ? (
          <Button
            type="primary"
            onClick={() =>
              onCreated({
                id: result.id,
                serviceName: result.serviceName,
                description: '',
                keyPrefix: result.apiKey.slice(0, 12),
                kbId,
                callCount: 0,
                updatedAt: '',
              })
            }
          >
            完成
          </Button>
        ) : (
          [
            <Button key="cancel" onClick={onClose}>
              取消
            </Button>,
            <Button key="submit" type="primary" loading={submitting} onClick={submit}>
              确认创建
            </Button>,
          ]
        )
      }
    >
      <p style={{ color: 'var(--text-sub)', fontSize: 13, margin: '0 0 16px' }}>
        将调试好的检索问答参数发布为知识服务，并通过 API Key 调用
      </p>

      {!result ? (
        <>
          <div className="field">
            <label>
              服务调用名称 <span className="required">*</span>
            </label>
            <input
              className="input"
              value={serviceName}
              onChange={(e) => setServiceName(e.target.value)}
              placeholder="例如：学生成绩问答 API"
              autoFocus
            />
          </div>
          <div className="field">
            <label>描述</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="给业务系统调用"
            />
          </div>
          {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} />}
        </>
      ) : (
        <div className="field">
          <label>API Key（仅展示一次，请妥善保存）</label>
          <div className="code-block">{result.apiKey}</div>
        </div>
      )}
    </Modal>
  );
}
