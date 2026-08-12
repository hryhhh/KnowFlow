import { nanoid } from "nanoid";

export const generateTraceId = (): string => nanoid(16);

export const generateAgentResultId = (): string => nanoid(8);

export const hashCacheKey = (query: string, provider: string, options: Record<string, any>): string => {
  const normalized = query.toLowerCase().trim().replace(/\s+/g, " ");
  const keyStr = `${normalized}#${provider}#${JSON.stringify(options)}`;
  // 简单哈希：使用 JS 内置算法
  let hash = 0;
  for (let i = 0; i < keyStr.length; i++) {
    const char = keyStr.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return `sha256_${Math.abs(hash).toString(16)}`;
};

export const sanitizeText = (text: string): string => {
  // 剥离 HTML 标签
  const noHtml = text.replace(/<[^>]*>/g, "");
  // 过滤敏感信息
  const noPhone = noHtml.replace(/1[3-9]\d{9}/g, "[PHONE]");
  const noIdCard = noPhone.replace(/\d{6}(19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{3}[\dXx]/g, "[ID]");
  const noEmail = noIdCard.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "[EMAIL]");
  return noEmail.trim();
};

export const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

export const withTimeout = <T>(promise: Promise<T>, ms: number, onTimeout: () => T): Promise<T> => {
  const timeout = new Promise<T>((resolve) => {
    setTimeout(() => resolve(onTimeout()), ms);
  });
  return Promise.race([promise, timeout]);
};
