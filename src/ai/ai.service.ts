import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private anthropic: Anthropic | null = null;

  constructor(
    @InjectDataSource() private dataSource: DataSource,
    private configService: ConfigService,
  ) {
    const apiKey = this.configService.get<string>('ANTHROPIC_API_KEY');
    if (apiKey) {
      this.anthropic = new Anthropic({ apiKey });
      this.logger.log('Anthropic Claude initialized for AI suggestions');
    } else {
      this.logger.warn('ANTHROPIC_API_KEY not set — using fallback templates');
    }
  }

  /**
   * Generate an AI suggestion for a conversation.
   */
  async generateSuggestion(
    conversationId: string,
    workspaceId: string,
    type: string,
    instructions?: string,
  ) {
    // 1. Verify conversation belongs to workspace
    const conversation = await this.dataSource.query(
      `SELECT c.id, c.subject, c.category, c.priority,
              ct.name as contact_name, ct.email as contact_email, ct.metadata as contact_metadata
       FROM conversations c
       LEFT JOIN contacts ct ON ct.id = c.contact_id
       WHERE c.id = $1 AND c.workspace_id = $2`,
      [conversationId, workspaceId],
    );

    if (!conversation || conversation.length === 0) {
      throw new NotFoundException('Conversation not found');
    }

    // 2. Get conversation messages for context
    const messages = await this.dataSource.query(
      `SELECT sender_type, direction, content_text, created_at
       FROM messages
       WHERE conversation_id = $1
       ORDER BY created_at ASC
       LIMIT 50`,
      [conversationId],
    );

    // 3. Build context
    const context = {
      conversation: conversation[0],
      messages: messages.map((m: any) => ({
        role: m.sender_type === 'contact' ? 'customer' : m.sender_type,
        content: m.content_text,
        timestamp: m.created_at,
      })),
      instructions,
    };

    // 4. Generate AI response
    let aiContent: string;
    let model = 'fallback';
    let confidence = 0.75;

    if (this.anthropic) {
      try {
        const result = await this.callClaude(type, context);
        aiContent = result.content;
        model = result.model;
        confidence = result.confidence;
      } catch (err) {
        this.logger.error(`Claude AI error: ${err.message}`);
        aiContent = this.generateFallbackResponse(type, context);
      }
    } else {
      aiContent = this.generateFallbackResponse(type, context);
    }

    // 5. Store the suggestion
    const result = await this.dataSource.query(
      `INSERT INTO ai_suggestions (conversation_id, type, content, confidence, model, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, type, content, confidence, model, created_at`,
      [
        conversationId,
        type,
        aiContent,
        confidence,
        model,
        JSON.stringify({ instructions, message_count: messages.length }),
      ],
    );

    // 6. Log event
    await this.dataSource.query(
      `INSERT INTO conversation_events (conversation_id, event_type, data) VALUES ($1, 'ai_suggestion', $2)`,
      [conversationId, JSON.stringify({ suggestion_id: result[0].id, type })],
    );

    return result[0];
  }

  /**
   * Call Claude for different suggestion types.
   */
  private async callClaude(
    type: string,
    context: { conversation: any; messages: any[]; instructions?: string },
  ): Promise<{ content: string; model: string; confidence: number }> {
    const contact =
      context.conversation.contact_name || context.conversation.contact_email || 'klant';
    const subject = context.conversation.subject || 'geen onderwerp';
    const messageHistory = context.messages
      .map((m: any) => `[${m.role}]: ${m.content?.substring(0, 500) || ''}`)
      .join('\n');

    let systemPrompt: string;
    let userPrompt: string;

    switch (type) {
      case 'reply':
        systemPrompt = `Je bent een professionele klantenservice medewerker. Schrijf een beleefde, behulpzame reactie in het Nederlands.
Gebruik HTML-opmaak met <p> tags. Houd het professioneel maar warm.
${context.instructions ? `Extra instructie: ${context.instructions}` : ''}`;
        userPrompt = `Gesprek met ${contact} over "${subject}":\n\n${messageHistory}\n\nSchrijf een passend antwoord:`;
        break;

      case 'summary':
        systemPrompt = `Je bent een AI assistent die klantenservice gesprekken samenvat. Schrijf een beknopte samenvatting in het Nederlands (max 3 zinnen).`;
        userPrompt = `Vat dit gesprek samen:\n\nOnderwerp: ${subject}\nKlant: ${contact}\n\n${messageHistory}`;
        break;

      case 'classification':
        systemPrompt = `Je classificeert klantenservice berichten. Antwoord met EXACT één van deze categorieën: offer_request, general_question, complaint, shipping, return, technical, billing, other. Geen uitleg, alleen de categorie.`;
        userPrompt = `Classificeer dit gesprek:\n\nOnderwerp: ${subject}\n\n${messageHistory}`;
        break;

      case 'sentiment':
        systemPrompt = `Je analyseert de stemming van klantberichten. Antwoord met EXACT één van: positive, neutral, negative, urgent. Geen uitleg, alleen het sentiment.`;
        userPrompt = `Bepaal het sentiment van de klant:\n\n${messageHistory}`;
        break;

      default:
        throw new Error(`Unknown suggestion type: ${type}`);
    }

    const message = await this.anthropic!.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const content = message.content[0]?.type === 'text' ? message.content[0].text : '';

    return {
      content,
      model: message.model,
      confidence: type === 'reply' ? 0.85 : 0.9,
    };
  }

  /**
   * List all suggestions for a conversation.
   */
  async listSuggestions(conversationId: string, workspaceId: string) {
    const check = await this.dataSource.query(
      `SELECT id FROM conversations WHERE id = $1 AND workspace_id = $2`,
      [conversationId, workspaceId],
    );

    if (!check || check.length === 0) {
      throw new NotFoundException('Conversation not found');
    }

    return this.dataSource.query(
      `SELECT id, type, content, confidence, model, accepted, accepted_by, created_at
       FROM ai_suggestions
       WHERE conversation_id = $1
       ORDER BY created_at DESC`,
      [conversationId],
    );
  }

  /**
   * Fallback templates when Claude is not available.
   */
  private generateFallbackResponse(
    type: string,
    context: { conversation: any; messages: any[]; instructions?: string },
  ): string {
    const contact =
      context.conversation.contact_name || context.conversation.contact_email || 'klant';

    switch (type) {
      case 'reply':
        return `<p>Beste ${contact},</p><p>Bedankt voor uw bericht. We hebben uw vraag ontvangen en zullen hier zo snel mogelijk op reageren.</p><p>Met vriendelijke groet,<br>Het Support Team</p>`;
      case 'summary':
        return `Gesprek met ${contact} over "${context.conversation.subject || 'geen onderwerp'}". ${context.messages.length} berichten uitgewisseld. Prioriteit: ${context.conversation.priority || 'normaal'}.`;
      case 'classification':
        return 'general_question';
      case 'sentiment':
        return 'neutral';
      default:
        return 'AI suggestion generated';
    }
  }
}
