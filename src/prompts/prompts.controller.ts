import { Controller, Post, UseGuards, Body, Req, BadRequestException } from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { IsString, IsOptional } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, AuthedUser } from '../auth/current-user.decorator';
import { PromptsService } from './prompts.service';

class PromptSubmitDto {
  @IsString()
  prompt_text: string;

  @IsOptional()
  @IsString()
  target?: string = 'linkedin_post';
}

@Controller('prompts')
@UseGuards(JwtAuthGuard)
export class PromptsController {
  constructor(private promptsService: PromptsService) {}

  @Post('transcribe')
  async transcribeAudio(@Req() request: FastifyRequest, @CurrentUser() user: AuthedUser) {
    const data = await request.file();

    if (!data) {
      throw new BadRequestException('No audio file uploaded');
    }

    const buffer = await data.toBuffer();

    return this.promptsService.transcribeAudio(user.orgId, user.userId, buffer, data.filename);
  }

  @Post('submit')
  async submitPrompt(@Body() dto: PromptSubmitDto, @CurrentUser() user: AuthedUser) {
    return this.promptsService.submitPrompt(
      user.orgId,
      user.userId,
      dto.prompt_text,
      dto.target || 'linkedin_post',
    );
  }
}
