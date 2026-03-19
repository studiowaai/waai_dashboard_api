import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class InboxService {
  private readonly logger = new Logger(InboxService.name);

  constructor(@InjectDataSource() private dataSource: DataSource) {}

  // ==================== CONVERSATIONS ====================

  async listConversations(
    workspaceId: string,
    filters: {
      status?: string;
      priority?: string;
      assigned_to?: string;
      channel_id?: string;
      search?: string;
    },
    limit = 50,
    offset = 0,
  ) {
    const whereClauses = ['c.workspace_id = $1'];
    const params: any[] = [workspaceId];
    let paramIndex = 2;

    if (filters.status) {
      whereClauses.push(`c.status = $${paramIndex++}`);
      params.push(filters.status);
    }

    if (filters.priority) {
      whereClauses.push(`c.priority = $${paramIndex++}`);
      params.push(filters.priority);
    }

    if (filters.assigned_to) {
      whereClauses.push(`c.assigned_to = $${paramIndex++}`);
      params.push(filters.assigned_to);
    }

    if (filters.channel_id) {
      whereClauses.push(`c.channel_id = $${paramIndex++}`);
      params.push(filters.channel_id);
    }

    if (filters.search) {
      whereClauses.push(
        `(c.subject ILIKE $${paramIndex} OR ct.name ILIKE $${paramIndex} OR ct.email ILIKE $${paramIndex})`,
      );
      params.push(`%${filters.search}%`);
      paramIndex++;
    }

    params.push(limit, offset);

    const query = `
      SELECT
        c.id,
        c.subject,
        c.status,
        c.priority,
        c.category,
        c.last_message_at,
        c.created_at,
        c.assigned_to,
        ct.id as contact_id,
        ct.name as contact_name,
        ct.email as contact_email,
        ct.avatar_url as contact_avatar,
        ch.name as channel_name,
        ch.type as channel_type,
        u.email as assignee_email,
        u.name as assignee_name,
        (SELECT content_text FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) as last_message_preview,
        (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) as message_count
      FROM conversations c
      LEFT JOIN contacts ct ON ct.id = c.contact_id
      LEFT JOIN channels ch ON ch.id = c.channel_id
      LEFT JOIN users u ON u.id = c.assigned_to
      WHERE ${whereClauses.join(' AND ')}
      ORDER BY c.last_message_at DESC NULLS LAST, c.created_at DESC
      LIMIT $${paramIndex - 1} OFFSET $${paramIndex}
    `;

    return this.dataSource.query(query, params);
  }

  async getConversation(conversationId: string, workspaceId: string) {
    const query = `
      SELECT
        c.*,
        ct.name as contact_name,
        ct.email as contact_email,
        ct.avatar_url as contact_avatar,
        ct.metadata as contact_metadata,
        ch.name as channel_name,
        ch.type as channel_type,
        u.email as assignee_email,
        u.name as assignee_name
      FROM conversations c
      LEFT JOIN contacts ct ON ct.id = c.contact_id
      LEFT JOIN channels ch ON ch.id = c.channel_id
      LEFT JOIN users u ON u.id = c.assigned_to
      WHERE c.id = $1 AND c.workspace_id = $2
    `;

    const result = await this.dataSource.query(query, [conversationId, workspaceId]);

    if (!result || result.length === 0) {
      throw new NotFoundException('Conversation not found');
    }

    return result[0];
  }

  async getConversationMessages(
    conversationId: string,
    workspaceId: string,
    limit = 100,
    offset = 0,
  ) {
    // Verify the conversation belongs to this workspace
    await this.getConversation(conversationId, workspaceId);

    const query = `
      SELECT
        m.id,
        m.sender_type,
        m.sender_id,
        m.direction,
        m.content_text,
        m.content_html,
        m.metadata,
        m.created_at,
        CASE
          WHEN m.sender_type = 'agent' THEN u.email
          WHEN m.sender_type = 'contact' THEN ct.email
          ELSE NULL
        END as sender_email,
        CASE
          WHEN m.sender_type = 'agent' THEN u.name
          WHEN m.sender_type = 'contact' THEN ct.name
          ELSE NULL
        END as sender_name
      FROM messages m
      LEFT JOIN users u ON u.id = m.sender_id AND m.sender_type = 'agent'
      LEFT JOIN contacts ct ON ct.id = m.sender_id AND m.sender_type = 'contact'
      WHERE m.conversation_id = $1
      ORDER BY m.created_at ASC
      LIMIT $2 OFFSET $3
    `;

    return this.dataSource.query(query, [conversationId, limit, offset]);
  }

  async assignConversation(
    conversationId: string,
    workspaceId: string,
    assigneeId: string,
    actorId: string,
  ) {
    const conversation = await this.getConversation(conversationId, workspaceId);

    await this.dataSource.query(
      `UPDATE conversations SET assigned_to = $1, status = 'assigned' WHERE id = $2`,
      [assigneeId, conversationId],
    );

    await this.logEvent(conversationId, actorId, 'assigned', { assigned_to: assigneeId });

    return { ok: true, message: 'Conversation assigned' };
  }

  async updateStatus(conversationId: string, workspaceId: string, status: string, actorId: string) {
    await this.getConversation(conversationId, workspaceId);

    const updates: Record<string, any> = { status };
    if (status === 'resolved') {
      updates.resolved_at = new Date();
    }

    await this.dataSource.query(
      `UPDATE conversations SET status = $1, resolved_at = $2 WHERE id = $3`,
      [status, status === 'resolved' ? new Date() : null, conversationId],
    );

    await this.logEvent(conversationId, actorId, 'status_changed', { status });

    return { ok: true, status };
  }

  async updatePriority(
    conversationId: string,
    workspaceId: string,
    priority: string,
    actorId: string,
  ) {
    await this.getConversation(conversationId, workspaceId);

    await this.dataSource.query(`UPDATE conversations SET priority = $1 WHERE id = $2`, [
      priority,
      conversationId,
    ]);

    await this.logEvent(conversationId, actorId, 'priority_changed', { priority });

    return { ok: true, priority };
  }

  async sendMessage(
    conversationId: string,
    workspaceId: string,
    userId: string,
    contentText: string,
    contentHtml?: string,
  ) {
    await this.getConversation(conversationId, workspaceId);

    const query = `
      INSERT INTO messages (conversation_id, sender_type, sender_id, direction, content_text, content_html)
      VALUES ($1, 'agent', $2, 'outbound', $3, $4)
      RETURNING id, sender_type, sender_id, direction, content_text, content_html, created_at
    `;

    const result = await this.dataSource.query(query, [
      conversationId,
      userId,
      contentText,
      contentHtml || null,
    ]);

    await this.logEvent(conversationId, userId, 'message_sent', { message_id: result[0].id });

    return result[0];
  }

  // ==================== AI SUGGESTIONS ====================

  async getAiSuggestions(conversationId: string, workspaceId: string) {
    await this.getConversation(conversationId, workspaceId);

    const query = `
      SELECT id, type, content, confidence, model, accepted, created_at
      FROM ai_suggestions
      WHERE conversation_id = $1
      ORDER BY created_at DESC
    `;

    return this.dataSource.query(query, [conversationId]);
  }

  async acceptAiSuggestion(suggestionId: string, workspaceId: string, userId: string) {
    const query = `
      UPDATE ai_suggestions
      SET accepted = true, accepted_by = $1
      WHERE id = $2
      AND conversation_id IN (SELECT id FROM conversations WHERE workspace_id = $3)
      RETURNING id, conversation_id
    `;

    const result = await this.dataSource.query(query, [userId, suggestionId, workspaceId]);

    if (!result || result.length === 0) {
      throw new NotFoundException('AI suggestion not found');
    }

    return { ok: true, suggestion_id: suggestionId };
  }

  // ==================== EVENTS ====================

  private async logEvent(
    conversationId: string,
    actorId: string,
    eventType: string,
    data: Record<string, any> = {},
  ) {
    await this.dataSource.query(
      `INSERT INTO conversation_events (conversation_id, actor_id, event_type, data) VALUES ($1, $2, $3, $4)`,
      [conversationId, actorId, eventType, JSON.stringify(data)],
    );
  }

  async getConversationEvents(conversationId: string, workspaceId: string) {
    await this.getConversation(conversationId, workspaceId);

    const query = `
      SELECT ce.id, ce.event_type, ce.data, ce.created_at, u.email as actor_email, u.name as actor_name
      FROM conversation_events ce
      LEFT JOIN users u ON u.id = ce.actor_id
      WHERE ce.conversation_id = $1
      ORDER BY ce.created_at DESC
    `;

    return this.dataSource.query(query, [conversationId]);
  }
}
