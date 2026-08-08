import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { DocumentService } from "./document.service";
import { UploadDocumentDto } from "./dto/upload-document.dto";

@Controller("knowledge-bases/:kbId/documents")
export class DocumentController {
  constructor(private readonly service: DocumentService) {}

  @Post()
  @UseInterceptors(FileInterceptor("file"))
  async upload(
    @Param("kbId") kbId: string,
    @UploadedFile() file: Express.Multer.File,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    @Query() _dto: UploadDocumentDto,
  ) {
    if (!file) throw new BadRequestException("请选择要上传的文件");
    const result = await this.service.upload(
      kbId,
      { originalname: file.originalname, buffer: file.buffer, size: file.size },
      _dto.processStrategy,
    );
    return result;
  }

  @Get()
  async findAll(
    @Param("kbId") kbId: string,
    @Query("search") search?: string,
  ) {
    const list = await this.service.findAll(kbId, search);
    return { code: 0, data: list };
  }

  @Delete(":docId")
  async remove(
    @Param("kbId") _kbId: string,
    @Param("docId") docId: string,
  ) {
    const res = await this.service.remove(docId);
    return { code: 0, data: res };
  }
}
