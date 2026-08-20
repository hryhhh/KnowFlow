import { IsString, IsOptional, MaxLength } from 'class-validator';

export class CreateApiServiceDto {
  @IsString()
  @MaxLength(128)
  serviceName: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsString()
  kbId: string;

  @IsOptional()
  @IsString()
  creator?: string;
}
