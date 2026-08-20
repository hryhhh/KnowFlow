import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Document } from '@langchain/core/documents';

/** Agent 轻量解析 API 配置 */
const AGENT_API_BASE = process.env.MINERU_AGENT_API_BASE_URL ?? 'https://mineru.net/api/v1/agent';
const AGENT_POLL_INTERVAL_MS = Number(process.env.MINERU_AGENT_POLL_INTERVAL_MS ?? '3000');
const AGENT_POLL_TIMEOUT_S = Number(process.env.MINERU_AGENT_POLL_TIMEOUT_S ?? '120');

/** Agent API 提交请求体 */
interface AgentSubmitBody {
  file_name: string;
  language?: string;
  enable_table?: boolean;
  is_ocr?: boolean;
  enable_formula?: boolean;
  page_range?: string;
}

/** Agent API 提交响应 */
interface AgentSubmitResponse {
  code: number;
  msg: string;
  data: {
    task_id: string;
    file_url?: string;
  };
}

/** Agent API 轮询响应 */
interface AgentPollResponse {
  code: number;
  msg: string;
  data: {
    task_id: string;
    state: 'waiting-file' | 'uploading' | 'pending' | 'running' | 'done' | 'failed';
    markdown_url?: string;
    err_msg?: string;
    err_code?: number;
  };
}

/**
 * 通过 MinerU Agent 轻量解析 API 解析 PDF。
 *
 * 流程：
 *   1. POST /parse/file → 获得 task_id + 签名上传 URL
 *   2. PUT 上传文件到 file_url
 *   3. 轮询 GET /parse/{task_id} 直到 done / failed
 *   4. 从 markdown_url 下载 Markdown
 *
 * @returns Document[]，单条包含整个 Markdown；文件超出 Agent API 限制时返回 null，由调用方降级
 */
export async function loadPDFWithAgentAPI(
  filePath: string,
  options?: {
    language?: string;
    enableTable?: boolean;
    isOcr?: boolean;
    enableFormula?: boolean;
    pageRange?: string;
  },
): Promise<Document[] | null> {
  const absolutePath = path.resolve(filePath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`PDF 文件不存在: ${absolutePath}`);
  }

  const fileInfo = fs.statSync(absolutePath);
  if (fileInfo.size === 0) {
    throw new Error(`PDF 文件为空: ${absolutePath}`);
  }

  // 超出 Agent API 限制，返回 null 让调用方降级
  if (fileInfo.size > 10 * 1024 * 1024) {
    console.warn(
      `[agent-api] 文件 ${fileInfo.size / 1024 / 1024.0}MB 超过 Agent API 10MB 限制，将使用基础解析`,
    );
    return null;
  }

  const fileName = path.basename(filePath);

  // Step 1: 获取 signed upload URL
  const submitRes = await agentSubmit(fileName, options);
  const { task_id, file_url } = submitRes.data;
  console.log(`[agent-api] task created: ${task_id}`);

  // Step 2: PUT 上传文件
  const uploadRes = await fetch(file_url!, {
    method: 'PUT',
    duplex: 'half' as unknown as 'half',
    body: fs.createReadStream(absolutePath),
  });
  if (!uploadRes.ok) {
    throw new Error(`Agent API 文件上传失败 HTTP ${uploadRes.status}: ${await uploadRes.text()}`);
  }
  console.log(`[agent-api] file uploaded, HTTP ${uploadRes.status}`);

  // Step 3: 轮询结果
  const markdownUrl = await agentPollResult(task_id);
  if (markdownUrl === null) {
    return null; // 超出限制，让调用方降级
  }
  console.log(`[agent-api] extraction done, markdown_url: ${markdownUrl}`);

  // Step 4: 下载 Markdown
  const mdRes = await fetch(markdownUrl);
  if (!mdRes.ok) {
    throw new Error(`Agent API Markdown 下载失败 HTTP ${mdRes.status}`);
  }
  const markdown = await mdRes.text();

  return [
    {
      pageContent: markdown,
      metadata: {
        source: fileName,
        fileType: 'pdf',
        parser: 'mineru-agent-api',
      },
    },
  ];
}

async function agentSubmit(
  fileName: string,
  options?: {
    language?: string;
    enableTable?: boolean;
    isOcr?: boolean;
    enableFormula?: boolean;
    pageRange?: string;
  },
): Promise<AgentSubmitResponse> {
  const body: AgentSubmitBody = { file_name: fileName };
  if (options?.language) body.language = options.language;
  if (options?.enableTable !== undefined) body.enable_table = options.enableTable;
  if (options?.isOcr !== undefined) body.is_ocr = options.isOcr;
  if (options?.enableFormula !== undefined) body.enable_formula = options.enableFormula;
  if (options?.pageRange) body.page_range = options.pageRange;

  const res = await fetch(`${AGENT_API_BASE}/parse/file`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Agent API 提交失败 HTTP ${res.status}: ${await res.text()}`);
  }

  const json = (await res.json()) as AgentSubmitResponse;
  if (json.code !== 0) {
    throw new Error(`Agent API 提交错误: ${json.msg}`);
  }
  if (!json.data.file_url) {
    throw new Error('Agent API 返回缺少 file_url');
  }
  return json;
}

async function agentPollResult(task_id: string): Promise<string | null> {
  const deadline = Date.now() + AGENT_POLL_TIMEOUT_S * 1000;

  while (Date.now() < deadline) {
    const res = await fetch(`${AGENT_API_BASE}/parse/${task_id}`);
    if (!res.ok) {
      throw new Error(`Agent API 轮询失败 HTTP ${res.status}`);
    }
    const json = (await res.json()) as AgentPollResponse;
    const state = json.data.state;

    if (state === 'done') {
      if (!json.data.markdown_url) {
        throw new Error('Agent API 任务完成但缺少 markdown_url');
      }
      return json.data.markdown_url;
    }
    if (state === 'failed') {
      const errCode = json.data.err_code;
      const errMsg = json.data.err_msg ?? 'unknown';
      // 文件/页数超限，返回 null 让上层降级到基础解析
      if (errCode === -30001 || errCode === -30003) {
        console.warn(`[agent-api] 超出限制: ${errMsg}，将降级到基础 PDF 解析`);
        return null;
      }
      throw new Error(`Agent API 提取失败: ${errMsg}`);
    }
    // pending / running / waiting-file / uploading — 继续等待
    await new Promise((r) => setTimeout(r, AGENT_POLL_INTERVAL_MS));
  }

  console.warn(`[agent-api] 轮询超时（${AGENT_POLL_TIMEOUT_S}s），将降级到基础 PDF 解析`);
  return null;
}
