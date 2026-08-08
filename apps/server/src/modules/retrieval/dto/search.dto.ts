import { IsString, IsNumber, IsBoolean, IsOptional } from "class-validator";

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
}
