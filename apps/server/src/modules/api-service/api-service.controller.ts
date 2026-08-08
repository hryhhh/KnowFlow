import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
} from "@nestjs/common";
import { ApiKeyService } from "./api-key.service";
import { CreateApiServiceDto } from "./dto/create-api-service.dto";

@Controller("api-services")
export class ApiServiceController {
  constructor(private readonly service: ApiKeyService) {}

  @Post()
  async create(@Body() dto: CreateApiServiceDto) {
    const res = await this.service.create(dto);
    return { code: 0, data: res };
  }

  @Get()
  async findAll() {
    const list = await this.service.findAll();
    return { code: 0, data: list };
  }

  @Delete(":serviceId")
  async remove(@Param("serviceId") serviceId: string) {
    const res = await this.service.remove(serviceId);
    return { code: 0, data: res };
  }
}
