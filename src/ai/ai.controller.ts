import { Controller, Post, Get, Param, Body, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, AuthedUser } from '../auth/current-user.decorator';
import { AiService } from './ai.service';
import { GenerateSuggestionDto } from './ai.dto';

@Controller('ai')
@UseGuards(JwtAuthGuard)
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('suggest')
  async generateSuggestion(@CurrentUser() user: AuthedUser, @Body() body: GenerateSuggestionDto) {
    return this.aiService.generateSuggestion(
      body.conversation_id,
      user.orgId,
      body.type,
      body.instructions,
    );
  }

  @Get('conversations/:id/suggestions')
  async listSuggestions(@CurrentUser() user: AuthedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.aiService.listSuggestions(id, user.orgId);
  }
}
