import { IsOptional, IsString, IsEnum, IsUUID, MinLength } from 'class-validator';

export enum ConversationStatus {
  OPEN = 'open',
  ASSIGNED = 'assigned',
  SNOOZED = 'snoozed',
  RESOLVED = 'resolved',
  CLOSED = 'closed',
}

export enum ConversationPriority {
  URGENT = 'urgent',
  HIGH = 'high',
  NORMAL = 'normal',
  LOW = 'low',
}

export class ListConversationsDto {
  @IsOptional()
  @IsEnum(ConversationStatus)
  status?: ConversationStatus;

  @IsOptional()
  @IsEnum(ConversationPriority)
  priority?: ConversationPriority;

  @IsOptional()
  @IsUUID()
  assigned_to?: string;

  @IsOptional()
  @IsUUID()
  channel_id?: string;

  @IsOptional()
  @IsString()
  search?: string;
}

export class AssignConversationDto {
  @IsUUID()
  user_id: string;
}

export class UpdateConversationStatusDto {
  @IsEnum(ConversationStatus)
  status: ConversationStatus;
}

export class UpdateConversationPriorityDto {
  @IsEnum(ConversationPriority)
  priority: ConversationPriority;
}

export class SendMessageDto {
  @IsString()
  @MinLength(1)
  content_text: string;

  @IsOptional()
  @IsString()
  content_html?: string;
}
