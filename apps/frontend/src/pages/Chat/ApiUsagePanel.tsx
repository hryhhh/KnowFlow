import type { ApiServiceItem } from '../../types';

export default function ApiUsagePanel({ service }: { service: ApiServiceItem }) {
  const endpoint = `/api/service-calls/${service.id}/chat/stream`;
  const apiKey = `${service.keyPrefix}…（创建时展示的完整 Key）`;
  const host = window.location.origin || 'https://your-domain';

  const curl = `curl -N -X POST "${host}${endpoint}" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${service.keyPrefix}YOUR_API_KEY" \\
  -d '{"query":"成绩多少"}'`;

  return (
    <div className="sources" style={{ width: 320 }}>
      <h3 style={{ marginTop: 0 }}>API 调用</h3>
      <p style={{ color: 'var(--text-sub)', fontSize: 12 }}>
        使用服务 ID 与 API Key，将知识库问答接入业务系统
      </p>

      <div className="field">
        <label>请求地址</label>
        <div className="code-block">{endpoint}</div>
      </div>

      <div className="field">
        <label>鉴权 Header</label>
        <div className="code-block">Authorization: Bearer {service.keyPrefix}YOUR_API_KEY</div>
      </div>

      <div className="field">
        <label>API Key</label>
        <div className="code-block">{apiKey}</div>
      </div>

      <div className="field">
        <label>请求示例</label>
        <div className="code-block">{curl}</div>
      </div>

      <p style={{ fontSize: 12, color: 'var(--text-sub)' }}>
        返回类型为 text/event-stream，事件类型：sources / token / done / error
      </p>
    </div>
  );
}
