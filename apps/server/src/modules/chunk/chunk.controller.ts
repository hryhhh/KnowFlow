import { Controller, Get, Post, Put, Delete, Param, Query, Body } from "@nestjs/common";
import { ChunkService } from "./chunk.service";

@Controller()
export class ChunkController {
  constructor(private readonly service: ChunkService) {}

  @Get("documents/:docId/chunks")
  async findByDoc(
    @Param("docId") docId: string,
    @Query("pageSize") pageSize = "10",
    @Query("page") page = "1",
  ) {
    const res = await this.service.findByDoc(
      docId,
      parseInt(pageSize, 10),
      parseInt(page, 10),
    );
    return { code: 0, data: res };
  }

  @Get("chunks/:chunkId")
  async findOne(@Param("chunkId") chunkId: string) {
    const card = await this.service.findOne(chunkId);
    return { code: 0, data: card };
  }

  @Get("knowledge-bases/:kbId/chunks")
  async findByKb(
    @Param("kbId") kbId: string,
    @Query("pageSize") pageSize = "10",
    @Query("page") page = "1",
  ) {
    const res = await this.service.findByKb(
      kbId,
      parseInt(pageSize, 10),
      parseInt(page, 10),
    );
    return { code: 0, data: res };
  }

  @Post("documents/:docId/chunks")
  async create(
    @Param("docId") docId: string,
    @Body() body: { content: string; title?: string },
  ) {
    const card = await this.service.create(docId, body.content, body.title);
    return { code: 0, data: card };
  }

  @Put("chunks/:chunkId")
  async update(
    @Param("chunkId") chunkId: string,
    @Body() body: { content: string; title?: string },
  ) {
    const card = await this.service.update(chunkId, body.content, body.title);
    return { code: 0, data: card };
  }

  @Delete("chunks/:chunkId")
  async remove(@Param("chunkId") chunkId: string) {
    await this.service.remove(chunkId);
    return { code: 0, data: null };
  }
}
