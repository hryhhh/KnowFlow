import * as fs from "node:fs";
import * as path from "node:path";
import AdmZip from "adm-zip";
import type { Document } from "@langchain/core/documents";

/** MinerU API 配置，从环境变量读取 */
const MINERU_API_URL =
  process.env.MINERU_API_URL ?? "http://localhost:8000";
const MINERU_BACKEND = process.env.MINERU_BACKEND ?? "pipeline";
const MINERU_EFFORT = process.env.MINERU_EFFORT ?? "medium";

/** MinerU /file_parse 请求参数 */
interface ParseParams {
  langList?: string[];
  parseMethod?: "auto" | "txt" | "ocr";
  formulaEnable?: boolean;
  tableEnable?: boolean;
  imageAnalysis?: boolean;
  backend?: string;
  effort?: string;
}

/** MinerU /file_parse 响应（ZIP 格式） */
interface ParseResponse {
  task_id?: string;
  status?: string;
  // 当 response_format_zip=false 时直接返回 markdown 字符串
  md_content?: string;
}

/**
 * 通过 MinerU API 将 PDF 解析为带标题层级的 Markdown。
 *
 * 流程：
 *   1. POST /file_parse 同步解析（小文件 < 10MB）
 *   2. 若响应为 ZIP，解压取出 .md 文件
 *   3. 失败时降级到 pdf-parse 兜底
 *
 * @returns Document[]，每个 Document.pageContent 是一整段 Markdown
 */
export async function loadPDF(
  filePath: string,
  options: ParseParams = {},
): Promise<Document[]> {
  const absolutePath = path.resolve(filePath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`PDF 文件不存在: ${absolutePath}`);
  }

  const fileInfo = fs.statSync(absolutePath);
  if (fileInfo.size === 0) {
    throw new Error(`PDF 文件为空: ${absolutePath}`);
  }

  try {
    const markdown = await parseWithMinerU(absolutePath, options);
    if (!markdown) {
      return [];
    }
    // 将 Markdown 作为整体返回，由上层 splitter 按标题分层切片
    return [
      {
        pageContent: markdown,
        metadata: {
          source: path.basename(filePath),
          fileType: "pdf",
        },
      },
    ];
  } catch (err) {
    console.warn(
      `[pdf-loader] MinerU 解析失败，降级到 pdf-parse: ${err}`,
    );
    return await loadPDFFallback(absolutePath);
  }
}

/**
 * 调用 MinerU /file_parse 同步接口。
 * 内部处理 ZIP 响应，返回 Markdown 字符串。
 */
async function parseWithMinerU(
  filePath: string,
  options: ParseParams,
): Promise<string> {
  const formData = new FormData();
  const fileBuffer = fs.readFileSync(filePath);
  const blob = new Blob([fileBuffer], { type: "application/pdf" });
  formData.append("files", blob, path.basename(filePath));
  formData.append("return_md", "true");
  formData.append("backend", MINERU_BACKEND);
  formData.append("effort", MINERU_EFFORT);
  formData.append("response_format_zip", "true");
  formData.append("lang_list", "ch");
  formData.append("formula_enable", String(options.formulaEnable ?? true));
  formData.append("table_enable", String(options.tableEnable ?? true));
  if (options.parseMethod) {
    formData.append("parse_method", options.parseMethod);
  }

  const res = await fetch(`${MINERU_API_URL}/file_parse`, {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `MinerU /file_parse 返回 ${res.status}: ${text.slice(0, 200)}`,
    );
  }

  // 判断响应类型：ZIP 还是纯文本
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/zip") || contentType.includes("octet-stream")) {
    return extractMarkdownFromZip(await res.arrayBuffer() as unknown as ArrayBuffer);
  }

  // 某些版本可能直接返回 markdown 文本
  const text = await res.text();
  if (text.startsWith("#") || text.length > 50) {
    return text;
  }

  // 尝试解析 JSON（部分版本返回 JSON）
  try {
    const json = JSON.parse(text) as ParseResponse;
    if (json.md_content) return json.md_content;
    if (json.task_id) {
      return await pollForResult(json.task_id);
    }
  } catch {
    // 不是 JSON，忽略
  }

  throw new Error("MinerU 返回了无法解析的响应格式");
}

/**
 * 从 ZIP ArrayBuffer 中解压并取出 .md 文件内容。
 */
function extractMarkdownFromZip(zipBuffer: ArrayBuffer): string {
  const zip = new AdmZip(Buffer.from(zipBuffer));
  const mdEntries = zip
    .getEntries()
    .filter((e) => e.entryName.endsWith(".md") && !e.isDirectory);

  if (mdEntries.length === 0) {
    throw new Error("MinerU ZIP 响应中未找到 .md 文件");
  }

  // 优先取 content_list_v2 对应的主 md 文件
  const primary = mdEntries.find((e) =>
    e.entryName.includes("content_list_v2") ||
    e.entryName.split("/").pop()?.startsWith("page_"),
  ) ?? mdEntries[0];

  return primary.getData().toString("utf8");
}

/**
 * 轮询异步任务结果（备用路径）。
 */
async function pollForResult(
  taskId: string,
  maxRetries = 60,
  intervalMs = 2000,
): Promise<string> {
  for (let i = 0; i < maxRetries; i++) {
    await new Promise((r) => setTimeout(r, intervalMs));

    const statusRes = await fetch(
      `${MINERU_API_URL}/tasks/${taskId}`,
    );
    if (!statusRes.ok) continue;

    const status = (await statusRes.json()) as { status: string };
    if (status.status === "completed" || status.status === "success") {
      const resultRes = await fetch(
        `${MINERU_API_URL}/tasks/${taskId}/result`,
      );
      if (resultRes.ok) {
        const buffer = Buffer.from(await resultRes.arrayBuffer());
        return extractMarkdownFromZip(buffer as unknown as ArrayBuffer);
      }
    }
    if (status.status === "failed" || status.status === "error") {
      throw new Error(`MinerU 任务失败: ${taskId}`);
    }
  }
  throw new Error(`MinerU 任务超时: ${taskId}`);
}

/**
 * 降级方案：使用 pdf-parse 提取纯文本（无结构）。
 */
async function loadPDFFallback(filePath: string): Promise<Document[]> {
  const { default: pdfParse } = await import("pdf-parse");
  const data = await pdfParse(fs.readFileSync(filePath));
  return [
    {
      pageContent: data.text.trim(),
      metadata: {
        source: path.basename(filePath),
        fileType: "pdf",
        fallback: true,
      },
    },
  ];
}
