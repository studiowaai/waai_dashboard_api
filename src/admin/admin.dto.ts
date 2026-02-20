import { IsString, IsEmail, MinLength, IsOptional, IsBoolean, IsArray } from 'class-validator';

export class OrganizationCreateDto {
  @IsString()
  name: string;
}

export class OrganizationUpdateDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  n8n_transcribe_webhook_url?: string;

  @IsOptional()
  @IsString()
  n8n_prompt_webhook_url?: string;

  @IsOptional()
  @IsString()
  n8n_approval_webhook_url?: string;
}

export class UserCreateDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsString()
  role: string = 'viewer';

  @IsString()
  org_id: string;
}

export class UserUpdateDto {
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;

  @IsOptional()
  @IsString()
  role?: string;
}

export class UserPermissionsUpdateDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  page_permissions?: string[] | null;
}

export class IngestTokenCreateDto {
  @IsString()
  org_id: string;

  @IsString()
  name: string;
}

export class IngestTokenUpdateDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
