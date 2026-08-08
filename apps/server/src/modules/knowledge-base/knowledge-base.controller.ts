import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
} from "@nestjs/common";
import { KnowledgeBaseService } from "./knowledge-base.service";
import { CreateKbDto, UpdateKbDto } from "./dto/create-kb.dto";

@Controller("knowledge-bases")
export class KnowledgeBaseController {
  constructor(private readonly service: KnowledgeBaseService) {}

  @Post()
  async create(@Body() dto: CreateKbDto) {
    const kb = await this.service.create(dto);
    return { code: 0, data: kb };
  }

  @Get()
  async findAll(@Query("search") search?: string) {
    const list = await this.service.findAll(search);
    return { code: 0, data: list };
  }

  @Get(":id")
  async findOne(@Param("id") id: string) {
    const kb = await this.service.findOne(id);
    return { code: 0, data: kb };
  }

  @Put(":id")
  async update(@Param("id") id: string, @Body() dto: UpdateKbDto) {
    const kb = await this.service.update(id, dto);
    return { code: 0, data: kb };
  }

  @Delete(":id")
  async remove(@Param("id") id: string) {
    const res = await this.service.remove(id);
    return { code: 0, data: res };
  }
}
