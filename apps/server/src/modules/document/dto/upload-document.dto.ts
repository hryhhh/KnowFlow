import { IsString, IsOptional } from "class-validator";

export class UploadDocumentDto {
  @IsOptional()
  @IsString()
  processStrategy?: string;
}
