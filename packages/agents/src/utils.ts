import { nanoid } from "nanoid";

/** 生成链路追踪 ID（16 位） */
export const generateTraceId = (): string => nanoid(16);

/** 生成 Agent 结果 ID（8 位） */
export const generateAgentResultId = (): string => nanoid(8);

/**
 * 生成缓存 Key
 * Key = sha256(normalizedQuery + providerName + JSON.stringify(options))
 */
export const hashCacheKey = (
  query: string,
  provider: string,
  options: Record<string, any>,
): string => {
  const normalized = query.toLowerCase().trim().replace(/\s+/g, " ");
  const keyStr = `${normalized}#${provider}#${JSON.stringify(options)}`;
  let hash = 0;
  for (let i = 0; i < keyStr.length; i++) {
    const char = keyStr.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return `sha256_${Math.abs(hash).toString(16)}`;
};

/**
 * 过滤敏感信息：剥离 HTML 标签、手机号、身份证、邮箱
 */
export const sanitizeText = (text: string): string => {
  let result = text.replace(/<[^>]*>/g, "");
  result = result.replace(/1[3-9]\d{9}/g, "[PHONE]");
  result = result.replace(
    /\d{6}(19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{3}[\dXx]/g,
    "[ID]",
  );
  result = result.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "[EMAIL]");
  return result.trim();
};

/** 延迟工具 */
export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
