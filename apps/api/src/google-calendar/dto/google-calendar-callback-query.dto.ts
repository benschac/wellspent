import { IsOptional, IsString, MaxLength } from "class-validator";

export class GoogleCalendarCallbackQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  error?: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  state?: string;
}
