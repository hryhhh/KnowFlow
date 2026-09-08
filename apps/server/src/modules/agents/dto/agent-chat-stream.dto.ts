import { Type } from 'class-transformer';
import { IsObject, IsOptional, IsString } from 'class-validator';
import { SearchParamsDto } from '../../../common/dto/search-params.dto';

/** POST /api/agents/routeStream 与 /api/agents/route 请求体（temperature 越界 422） */
export class AgentChatStreamDto {
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
