/**
 * 应用层分词器（fallback：字符级 N-gram）
 *
 * node-jieba 未安装时自动降级为 unigram + bigram 策略。
 * 结果统一 lowercased，供 tsvector/tsquery 使用。
 */

/**
 * 将文本切分为 lowercase token 数组
 */
export function tokenize(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  // 英文单词整体保留，中文按字符拆为 unigram + bigram
  // 允许连字符（如 E-1042）作为词内字符
  const tokens: string[] = [];
  const chars = trimmed.split('');

  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    // 连续字母数字或连字符保留为整体（如 "E-1042"、"pdf"）
    if (/^[a-zA-Z0-9-]+$/.test(c)) {
      let word = c;
      let j = i + 1;
      while (j < chars.length && /^[a-zA-Z0-9-]+$/.test(chars[j])) {
        word += chars[j];
        j++;
      }
      // 去除首尾连字符
      word = word.replace(/^-+|-+$/g, '');
      if (word) tokens.push(word.toLowerCase());
      i = j - 1;
      continue;
    }
    // 中文字符：unigram
    tokens.push(c.toLowerCase());
    // bigram（相邻两个中文字符）
    if (i + 1 < chars.length) {
      tokens.push((c + chars[i + 1]).toLowerCase());
    }
  }

  // 去重保持顺序
  return [...new Set(tokens)];
}

/**
 * 将 token 数组转为 simple 配置的 tsvector 字符串
 * 例：['如何', '重置', '密码'] → "'如何' '重置' '密码'"
 */
export function tokensToTsvString(tokens: string[]): string {
  // tsvector 要求 token 不含空格/引号，单个 token 直接用空格分隔
  return tokens.join(' ');
}

/**
 * 将 token 数组转为 PostgreSQL tsquery 字符串（AND 连接）
 * 例：['怎么', '重置'] → "'怎么':* & '重置':*"
 * 使用 prefix operator 以支持部分匹配中文；含特殊字符的 token 加引号。
 */
export function tokensToTsQuery(tokens: string[]): string {
  if (tokens.length === 0) return '';
  return tokens
    .map((t) => {
      // tsquery 中单引号用于转义包含特殊字符的 token
      if (/[^a-z0-9]/.test(t)) {
        return `'${t}':*`;
      }
      return `${t}:*`;
    })
    .join(' & ');
}
