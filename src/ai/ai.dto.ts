import { IsString, IsOptional, IsEnum, IsUUID } from 'class-validator';

export enum SuggestionType {
  REPLY = 'reply',
  SUMMARY = 'summary',
  CLASSIFICATION = 'classification',
  SENTIMENT = 'sentiment',
}

export class GenerateSuggestionDto {
  @IsUUID()
  conversation_id: string;

  @IsEnum(SuggestionType)
  type: SuggestionType;

  @IsOptional()
  @IsString()
  instructions?: string;
}
