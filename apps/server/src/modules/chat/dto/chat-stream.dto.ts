import { Type } from 'class-transformer';
import { IsObject, IsOptional, IsString } from 'class-validator';
import { SearchParamsDto } from '../../../common/dto/search-params.dto';

/** POST /api/chat/stream 请求体（全局 ValidationPipe 校验，temperature 越界 422） */
export class ChatStreamDto {
  @IsString()
  query: string;

  @IsString()
  kbId: string;

  @IsOptional()
  @IsString()
  sessionId?: string;

  @IsOptional()
  @IsObject()
  @Type(() => SearchParamsDto)
  params?: SearchParamsDto;
}
