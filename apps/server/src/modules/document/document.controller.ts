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
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { DocumentService } from './document.service';

/** 上传文件的简化类型，避免依赖 Express.Multer.File（@types/express v5 兼容性断裂） */
interface UploadedFile {
  originalname: string;
  buffer: Buffer;
  size: number;
}

const MAX_UPLOAD_SIZE_MB = parseInt(process.env.MAX_UPLOAD_SIZE_MB ?? '100', 10);
const MAX_UPLOAD_SIZE_BYTES = MAX_UPLOAD_SIZE_MB * 1024 * 1024;

/** 过滤文件名中的非法字符，防止路径穿越 */
function sanitizeFilename(name: string): string {
  return name.replace(/[\/\\:*?"<>|]/g, '_');
}

@Controller('knowledge-bases/:kbId/documents')
export class DocumentController {
  constructor(private readonly service: DocumentService) {}

  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_UPLOAD_SIZE_BYTES },
      fileFilter: (_req, file, cb) => {
        file.originalname = sanitizeFilename(file.originalname);
        cb(null, true);
      },
    }),
  )
  async upload(
    @Param('kbId') kbId: string,
    @UploadedFile() file: UploadedFile,
    @Query('processStrategy') processStrategy?: string,
  ) {
    if (!file) throw new BadRequestException('请选择要上传的文件');
    if (file.size > MAX_UPLOAD_SIZE_BYTES) {
      throw new BadRequestException(`文件大小超出限制（最大 ${MAX_UPLOAD_SIZE_MB}MB）`);
    }
    const result = await this.service.upload(kbId, file, processStrategy);
    return result;
  }

  @Get()
  async findAll(@Param('kbId') kbId: string, @Query('search') search?: string) {
    const list = await this.service.findAll(kbId, search);
    return { code: 0, data: list };
  }

  @Delete(':docId')
  async remove(@Param('kbId') kbId: string, @Param('docId') docId: string) {
    const res = await this.service.remove(docId, kbId);
    return { code: 0, data: res };
  }
}
