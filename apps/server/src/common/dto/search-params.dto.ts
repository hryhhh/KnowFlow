import { IsBoolean, IsIn, IsNumber, IsOptional, Max, Min } from 'class-validator';

/**
 * chat / agents 链路共用的检索参数（嵌套 DTO）。
 * 含 temperature（0~2）：仅生成答案的链路生效，/api/retrieval/search 不接受该字段。
 */
export class SearchParamsDto {
  @IsOptional()
  @IsNumber()
  topK?: number;

  @IsOptional()
  @IsNumber()
  minScore?: number;

  @IsOptional()
  @IsBoolean()
  useReranker?: boolean;

  @IsOptional()
  @IsNumber()
  denseWeight?: number;

  /** 检索模式：vector | keyword | hybrid */
  @IsOptional()
  @IsIn(['vector', 'keyword', 'hybrid'])
  retrievalMode?: 'vector' | 'keyword' | 'hybrid';

  /** 融合方式：rrf | linear */
  @IsOptional()
  @IsIn(['rrf', 'linear'])
  fusionMethod?: 'rrf' | 'linear';

  /** RRF 公式中的 K 值，范围 1-200 */
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(200)
  rrfK?: number;

  /** 每路候选数倍数 = topK × multiplier，硬上限 10 */
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(10)
  candidateMultiplier?: number;

  /** 仅 hybrid 模式生效，过滤 dense 候选（可为 null 表示不施加） */
  @IsOptional()
  @IsNumber()
  minDenseScore?: number | null;

  /** LLM 生成温度（0~2），缺省用 DEFAULT_LLM_TEMPERATURE */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(2)
  temperature?: number;
}
