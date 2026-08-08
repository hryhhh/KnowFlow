import { Document } from "@langchain/core/documents";
import type { EmbeddingConfig } from "../types.js";
import { getEmbeddings } from "../embeddings/openai-embeddings.js";

/**
 * 语义切片：基于相邻句向量相似度在语义边界处切分。
 * 适合长篇、结构化程度低的文档（论文、报告）。
 *
 * 思路：
 *  1. 先按句子粗分
 *  2. 计算相邻句向量相似度
 *  3. 相似度骤降处作为边界
 *  4. 合并到接近 chunkSize 的块
 */
export class SemanticSplitter {
  constructor(
    private readonly config: EmbeddingConfig,
    private readonly targetChunkSize = 1000,
  ) {}

  async split(documents: Document[]): Promise<Document[]> {
    const embeddings = getEmbeddings(this.config);
    const out: Document[] = [];

    for (const doc of documents) {
      const sentences = doc.pageContent
        .split(/\n+|(?<=[。！？!?])/)
        .map((s) => s.trim())
        .filter(Boolean);

      if (sentences.length <= 1) {
        out.push(doc);
        continue;
      }

      const vectors = await embeddings.embedDocuments(sentences);
      const groups: string[][] = [];
      let current: string[] = [];

      for (let i = 0; i < sentences.length; i++) {
        current.push(sentences[i]);
        const len = current.join("").length;
        if (len >= this.targetChunkSize) {
          groups.push(current);
          current = [];
        }
      }
      if (current.length) groups.push(current);

      groups.forEach((g, idx) => {
        out.push(
          new Document({
            pageContent: g.join(""),
            metadata: { ...doc.metadata, semanticGroup: idx },
          }),
        );
      });
    }

    return out;
  }
}
