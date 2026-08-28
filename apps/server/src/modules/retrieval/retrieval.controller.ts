import { Controller, Post, Body, Headers } from '@nestjs/common';
import { RetrievalService } from './retrieval.service';
import { SearchDto } from './dto/search.dto';

@Controller('retrieval')
export class RetrievalController {
  constructor(private readonly service: RetrievalService) {}

  @Post('search')
  async search(@Body() dto: SearchDto, @Headers('x-debug') xDebug?: string) {
    // X-Debug header 可覆盖请求体参数，便于内部调试
    const effectiveDebug = dto.debug ?? xDebug === 'true';
    const result = await this.service.search({ ...dto, debug: effectiveDebug });
    if (effectiveDebug) {
      return { code: 0, data: { results: result.results, debug: result.debug, searchHistory: [] } };
    }
    return { code: 0, data: { results: result.results, searchHistory: [] } };
  }
}
