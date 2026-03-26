import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { GmailService, GmailMessage } from '../auth/gmail.service';

/**
 * GmailSyncService bridges the gap between live Gmail API reads
 * and the internal conversations/messages/contacts data model.
 *
 * It syncs Gmail threads into the unified inbox so that the
 * multi-channel conversation model works as designed.
 */
@Injectable()
export class GmailSyncService {
  private readonly logger = new Logger(GmailSyncService.name);

  constructor(
    @InjectDataSource() private dataSource: DataSource,
    private readonly gmailService: GmailService,
  ) {}

  /**
   * Sync a user's Gmail inbox into the conversations model.
   * Creates/updates contacts, channels, conversations, and messages.
   */
  async syncInbox(
    userId: string,
    workspaceId: string,
    maxResults = 50,
  ): Promise<{
    synced: number;
    created: number;
    updated: number;
    errors: number;
  }> {
    const stats = { synced: 0, created: 0, updated: 0, errors: 0 };

    try {
      // Ensure a Gmail channel exists for this workspace
      const channelId = await this.ensureGmailChannel(userId, workspaceId);

      // Fetch inbox from Gmail API
      const inbox = await this.gmailService.getInbox(userId, maxResults);

      // Group messages by threadId to create conversations
      const threads = new Map<string, GmailMessage[]>();
      for (const msg of inbox.messages) {
        const existing = threads.get(msg.threadId) || [];
        existing.push(msg);
        threads.set(msg.threadId, existing);
      }

      for (const [threadId, messages] of threads) {
        try {
          await this.syncThread(workspaceId, channelId, threadId, messages);
          stats.synced++;
        } catch (err) {
          this.logger.warn(`Failed to sync thread ${threadId}: ${err.message}`);
          stats.errors++;
        }
      }

      this.logger.log(
        `Gmail sync for user ${userId}: ${stats.synced} threads synced, ${stats.created} created, ${stats.updated} updated, ${stats.errors} errors`,
      );
    } catch (err) {
      this.logger.error(`Gmail sync failed for user ${userId}: ${err.message}`);
      throw err;
    }

    return stats;
  }

  /**
   * Sync a single Gmail thread into a conversation.
   */
  private async syncThread(
    workspaceId: string,
    channelId: string,
    threadId: string,
    messages: GmailMessage[],
  ) {
    // Sort messages by date
    messages.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    const firstMsg = messages[0];
    const lastMsg = messages[messages.length - 1];

    // Find or create the contact from the sender
    const senderEmail = this.extractEmail(firstMsg.from);
    const senderName = this.extractName(firstMsg.from);
    const contactId = await this.ensureContact(workspaceId, senderEmail, senderName);

    // Check if conversation already exists for this thread
    const existingConv = await this.dataSource.query(
      `SELECT id FROM conversations
       WHERE workspace_id = $1 AND external_id = $2 AND channel_id = $3`,
      [workspaceId, threadId, channelId],
    );

    let conversationId: string;

    if (existingConv.length > 0) {
      conversationId = existingConv[0].id;
      // Update last_message_at
      await this.dataSource.query(`UPDATE conversations SET last_message_at = $1 WHERE id = $2`, [
        new Date(lastMsg.date),
        conversationId,
      ]);
    } else {
      // Create new conversation
      const result = await this.dataSource.query(
        `INSERT INTO conversations (workspace_id, channel_id, contact_id, subject, status, priority, external_id, last_message_at)
         VALUES ($1, $2, $3, $4, 'open', 'medium', $5, $6)
         RETURNING id`,
        [
          workspaceId,
          channelId,
          contactId,
          firstMsg.subject || '(geen onderwerp)',
          threadId,
          new Date(lastMsg.date),
        ],
      );
      conversationId = result[0].id;
    }

    // Sync messages
    for (const msg of messages) {
      await this.syncMessage(conversationId, contactId, msg);
    }
  }

  /**
   * Sync a single Gmail message into the messages table.
   */
  private async syncMessage(conversationId: string, contactId: string, msg: GmailMessage) {
    // Check if message already exists (by external_id)
    const existing = await this.dataSource.query(
      `SELECT id FROM messages WHERE conversation_id = $1 AND external_id = $2`,
      [conversationId, msg.id],
    );

    if (existing.length > 0) return; // Already synced

    const isInbound = msg.labels.includes('INBOX');
    const senderType = isInbound ? 'contact' : 'agent';
    const direction = isInbound ? 'inbound' : 'outbound';

    await this.dataSource.query(
      `INSERT INTO messages (conversation_id, sender_type, sender_id, direction, content_text, content_html, external_id, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        conversationId,
        senderType,
        senderType === 'contact' ? contactId : null,
        direction,
        this.stripHtml(msg.body),
        msg.body,
        msg.id,
        JSON.stringify({
          gmail_thread_id: msg.threadId,
          from: msg.from,
          to: msg.to,
          subject: msg.subject,
          labels: msg.labels,
        }),
        new Date(msg.date),
      ],
    );
  }

  /**
   * Ensure a Gmail channel exists for this workspace + user.
   */
  private async ensureGmailChannel(userId: string, workspaceId: string): Promise<string> {
    // Check for existing Gmail channel
    const existing = await this.dataSource.query(
      `SELECT ch.id FROM channels ch
       WHERE ch.workspace_id = $1 AND ch.type = 'email'
       AND ch.name LIKE 'Gmail%'
       LIMIT 1`,
      [workspaceId],
    );

    if (existing.length > 0) return existing[0].id;

    // Get user's Gmail profile for the channel name
    let email = 'Gmail';
    try {
      const profile = await this.gmailService.getProfile(userId);
      email = `Gmail (${profile.email})`;
    } catch {
      // ignore
    }

    const result = await this.dataSource.query(
      `INSERT INTO channels (workspace_id, type, name, is_active)
       VALUES ($1, 'email', $2, true)
       RETURNING id`,
      [workspaceId, email],
    );

    return result[0].id;
  }

  /**
   * Find or create a contact by email within a workspace.
   */
  private async ensureContact(workspaceId: string, email: string, name?: string): Promise<string> {
    if (!email) {
      // Create anonymous contact
      const result = await this.dataSource.query(
        `INSERT INTO contacts (workspace_id, name) VALUES ($1, 'Onbekend') RETURNING id`,
        [workspaceId],
      );
      return result[0].id;
    }

    const existing = await this.dataSource.query(
      `SELECT id FROM contacts WHERE workspace_id = $1 AND email = $2`,
      [workspaceId, email],
    );

    if (existing.length > 0) {
      // Update name if we have a better one
      if (name && name !== email) {
        await this.dataSource.query(
          `UPDATE contacts SET name = COALESCE(NULLIF($1, ''), name) WHERE id = $2`,
          [name, existing[0].id],
        );
      }
      return existing[0].id;
    }

    const result = await this.dataSource.query(
      `INSERT INTO contacts (workspace_id, email, name)
       VALUES ($1, $2, $3)
       ON CONFLICT (workspace_id, email) DO UPDATE SET name = COALESCE(NULLIF(EXCLUDED.name, ''), contacts.name)
       RETURNING id`,
      [workspaceId, email, name || email],
    );

    return result[0].id;
  }

  // ── Helpers ──────────────────────────────────────────────

  private extractEmail(from: string): string {
    const match = from.match(/<([^>]+)>/);
    return match ? match[1] : from.trim();
  }

  private extractName(from: string): string {
    const match = from.match(/^([^<]+)</);
    return match ? match[1].trim().replace(/"/g, '') : '';
  }

  private stripHtml(html: string): string {
    return html
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
