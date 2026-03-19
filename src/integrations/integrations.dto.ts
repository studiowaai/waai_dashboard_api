import { IsString, IsOptional, IsUUID } from 'class-validator';

export class ConnectAccountDto {
  @IsString()
  provider_id: string;

  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
  @IsString()
  redirect_uri?: string;
}

export class DisconnectAccountDto {
  @IsUUID()
  account_id: string;
}
