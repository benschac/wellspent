import { IsOptional, IsString, MaxLength } from "class-validator";

export class GoogleCallbackQueryDto {
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
  // Google's additional callback fields are accepted but never used as proof
  // of permissions; the token response owns the granted scopes.
  @IsOptional()
  @IsString()
  @MaxLength(8192)
  scope?: string;
  @IsOptional()
  @IsString()
  @MaxLength(64)
  authuser?: string;
  @IsOptional()
  @IsString()
  @MaxLength(256)
  prompt?: string;
  @IsOptional()
  @IsString()
  @MaxLength(256)
  hd?: string;
}
