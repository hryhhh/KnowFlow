import { IsString, IsNumber, IsBoolean, IsOptional, IsIn, Min, Max } from 'class-validator';

export class SearchDto {
  @IsString()
  kbId: string;

  @IsString()
  query: string;

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

  /** 检索模式：vector | keyword | hybrid，默认 vector */
  @IsOptional()
  @IsIn(['vector', 'keyword', 'hybrid'])
  retrievalMode?: 'vector' | 'keyword' | 'hybrid';

  /** 融合方式，默认 rrf */
  @IsOptional()
  @IsIn(['rrf', 'linear'])
  fusionMethod?: 'rrf' | 'linear';

  /** RRF 公式中的 K 值，默认 60，范围 1-200 */
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(200)
  rrfK?: number;

  /** 每路候选数 = topK × multiplier，默认 3，硬上限 10 */
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(10)
  candidateMultiplier?: number;

  /** 仅 hybrid 模式生效，过滤 dense 候选，默认 null（不施加） */
  @IsOptional()
  @IsNumber()
  minDenseScore?: number;

  /** 是否开启调试模式，返回详细的检索信息 */
  @IsOptional()
  @IsBoolean()
  debug?: boolean;
}
