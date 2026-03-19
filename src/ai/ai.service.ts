import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    @InjectDataSource() private dataSource: DataSource,
    private configService: ConfigService,
  ) {}

  /**
   * Generate an AI suggestion for a conversation.
   *
   * This gathers conversation context (messages, contact info, Shopify context)
   * and calls the configured AI provider to generate a response.
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

    // 3. Build context for AI
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
    // TODO: Integrate with actual AI provider (OpenAI, Anthropic, etc.)
    // For now, generate a placeholder that demonstrates the data flow
    const aiContent = this.generatePlaceholderResponse(type, context);

    // 5. Store the suggestion
    const result = await this.dataSource.query(
      `INSERT INTO ai_suggestions (conversation_id, type, content, confidence, model, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, type, content, confidence, model, created_at`,
      [
        conversationId,
        type,
        aiContent,
        0.85,
        'placeholder',
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
   * List all suggestions for a conversation.
   */
  async listSuggestions(conversationId: string, workspaceId: string) {
    // Verify ownership
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
   * Placeholder response generator — will be replaced with actual AI integration.
   */
  private generatePlaceholderResponse(
    type: string,
    context: { conversation: any; messages: any[]; instructions?: string },
  ): string {
    const contact =
      context.conversation.contact_name || context.conversation.contact_email || 'klant';

    switch (type) {
      case 'reply':
        return `Beste ${contact},\n\nBedankt voor uw bericht. We hebben uw vraag ontvangen en zullen hier zo snel mogelijk op reageren.\n\nMet vriendelijke groet,\nHet Support Team`;

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
