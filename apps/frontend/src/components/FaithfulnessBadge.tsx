import { Tag, Popover } from 'antd';
import { SafetyCertificateOutlined } from '@ant-design/icons';
import type { FaithfulnessInfo } from '../types';

/**
 * A2：答案支撑度徽标（faithfulness 校验结果）。
 * 消息尾部展示 supported 比例，展开可查看逐条原子陈述的核查明细。
 */
export default function FaithfulnessBadge({ result }: { result: FaithfulnessInfo }) {
  const percent = Math.round(result.score * 100);
  const color = percent >= 80 ? '#52c41a' : percent >= 50 ? '#faad14' : '#ff4d4f';
  const supportedCount = result.claims.filter((c) => c.supported).length;

  const content = (
    <div style={{ maxWidth: 420, maxHeight: 280, overflowY: 'auto', fontSize: 12 }}>
      {result.claims.length === 0 ? (
        <span style={{ color: 'var(--text-subtle)' }}>未从答案中提取到可核查的陈述</span>
      ) : (
        result.claims.map((c: any, i: number) => (
          <div key={i} style={{ marginBottom: 6 }}>
            <span style={{ color: c.supported ? '#52c41a' : '#ff4d4f' }}>
              {c.supported ? '✓' : '✗'}
            </span>{' '}
            <span>{c.text}</span>
            {c.evidenceIndexes.length > 0 && (
              <span style={{ color: 'var(--text-subtle)' }}>
                {' '}
                [资料 {c.evidenceIndexes.map((n: number) => n + 1).join(',')}]{' '}
              </span>
            )}
          </div>
        ))
      )}
    </div>
  );

  return (
    <Popover
      content={content}
      title={`依据支撑明细（${supportedCount}/${result.claims.length}）`}
      trigger="click"
    >
      <Tag
        icon={<SafetyCertificateOutlined />}
        color={color}
        style={{ marginTop: 6, cursor: 'pointer' }}
      >
        依据支撑 {percent}%
      </Tag>
    </Popover>
  );
}
