import { Controller, Post, Body } from "@nestjs/common";
import { RetrievalService } from "./retrieval.service";
import { SearchDto } from "./dto/search.dto";

@Controller("retrieval")
export class RetrievalController {
  constructor(private readonly service: RetrievalService) {}

  @Post("search")
  async search(@Body() dto: SearchDto) {
    const results = await this.service.search(dto);
    return { code: 0, data: { results, searchHistory: [] } };
  }
}
