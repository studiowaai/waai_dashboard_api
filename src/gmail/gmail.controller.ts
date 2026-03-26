import { Controller, Get, Post, Param, Query, Body, UseGuards, Logger } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, AuthedUser } from '../auth/current-user.decorator';
import { GmailService } from '../auth/gmail.service';
import { GmailSyncService } from './gmail-sync.service';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

@Controller('gmail')
@UseGuards(JwtAuthGuard)
export class GmailController {
  private readonly logger = new Logger(GmailController.name);
  private openai: OpenAI | null = null;

  constructor(
    private readonly gmailService: GmailService,
    private readonly gmailSyncService: GmailSyncService,
    private readonly configService: ConfigService,
  ) {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    if (apiKey) {
      this.openai = new OpenAI({ apiKey });
    }
  }

  @Get('inbox')
  async getInbox(
    @CurrentUser() user: AuthedUser,
    @Query('limit') limit?: string,
    @Query('pageToken') pageToken?: string,
    @Query('q') query?: string,
  ) {
    return this.gmailService.getInbox(
      user.userId,
      limit ? parseInt(limit, 10) : 20,
      pageToken,
      query,
    );
  }

  @Get('messages/:id')
  async getMessage(@CurrentUser() user: AuthedUser, @Param('id') messageId: string) {
    return this.gmailService.getMessage(user.userId, messageId);
  }

  @Get('profile')
  async getProfile(@CurrentUser() user: AuthedUser) {
    return this.gmailService.getProfile(user.userId);
  }

  @Get('status')
  async getStatus(@CurrentUser() user: AuthedUser) {
    try {
      const profile = await this.gmailService.getProfile(user.userId);
      return { connected: true, email: profile.email };
    } catch {
      return { connected: false };
    }
  }

  /**
   * Generate an AI-powered email reply.
   * Takes the original email content + a short user instruction,
   * and produces a professional, ready-to-send reply.
   */
  @Post('generate-reply')
  async generateReply(
    @CurrentUser() user: AuthedUser,
    @Body()
    body: {
      originalFrom: string;
      originalSubject: string;
      originalBody: string;
      instruction: string;
      language?: string;
    },
  ) {
    const { originalFrom, originalSubject, originalBody, instruction, language } = body;
    const lang = language || 'Nederlands';

    if (!this.openai) {
      this.logger.warn('OpenAI not configured — using template fallback');
      return {
        reply: this.buildFallbackReply(originalFrom, instruction, lang),
        model: 'fallback',
      };
    }

    const systemPrompt = `Je bent een professionele e-mail assistent voor een bedrijf.
Genereer een beleefde, professionele e-mail reactie in het ${lang}.
De gebruiker geeft een korte instructie over wat het antwoord moet bevatten.
Schrijf ALLEEN de body van het e-mailbericht, geen onderwerp of headers.
Gebruik HTML-opmaak met <p> tags voor paragrafen en <br> voor regelafbrekingen.
Houd de toon beleefd maar niet te formeel.
Sluit af met "Met vriendelijke groet" gevolgd door een lege regel (de naam wordt later toegevoegd).`;

    const userPrompt = `Originele e-mail van: ${originalFrom}
Onderwerp: ${originalSubject}

Originele inhoud:
${this.stripHtml(originalBody).substring(0, 2000)}

---

Mijn instructie voor het antwoord: "${instruction}"

Genereer nu het antwoord:`;

    try {
      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.7,
        max_tokens: 1000,
      });

      const reply = completion.choices[0]?.message?.content || '';

      return {
        reply,
        model: completion.model,
        tokens: completion.usage?.total_tokens,
      };
    } catch (err) {
      this.logger.error(`OpenAI error: ${err.message}`);
      return {
        reply: this.buildFallbackReply(originalFrom, instruction, lang),
        model: 'fallback',
        error: 'AI tijdelijk niet beschikbaar — template gebruikt',
      };
    }
  }

  /**
   * Sync Gmail inbox into the conversations/messages/contacts model.
   */
  @Post('sync')
  async syncInbox(@CurrentUser() user: AuthedUser, @Body() body: { maxResults?: number }) {
    return this.gmailSyncService.syncInbox(user.userId, user.orgId, body?.maxResults || 50);
  }

  /**
   * Send an email reply via Gmail.
   */
  @Post('send-reply')
  async sendReply(
    @CurrentUser() user: AuthedUser,
    @Body()
    body: {
      originalMessageId: string;
      threadId: string;
      to: string;
      subject: string;
      body: string;
    },
  ) {
    return this.gmailService.sendReply(
      user.userId,
      body.originalMessageId,
      body.threadId,
      body.to,
      body.subject,
      body.body,
    );
  }

  // ── Helpers ──────────────────────────────────────────────

  private stripHtml(html: string): string {
    return html
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private buildFallbackReply(from: string, instruction: string, lang: string): string {
    const name = from.replace(/<.*>/, '').trim() || 'heer/mevrouw';
    if (lang.toLowerCase().includes('neder') || lang.toLowerCase().includes('dutch')) {
      return `<p>Beste ${name},</p>
<p>${instruction}</p>
<p>Met vriendelijke groet,</p>`;
    }
    return `<p>Dear ${name},</p>
<p>${instruction}</p>
<p>Kind regards,</p>`;
  }
}
