import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { google, gmail_v1 } from 'googleapis';

export interface GmailMessage {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  snippet: string;
  body: string;
  date: string;
  isUnread: boolean;
  labels: string[];
}

export interface GmailSyncResult {
  messages: GmailMessage[];
  totalCount: number;
  nextPageToken?: string;
}

@Injectable()
export class GmailService {
  private readonly logger = new Logger(GmailService.name);

  constructor(@InjectDataSource() private dataSource: DataSource) {}

  /**
   * Get authenticated Gmail client for a user
   */
  private async getGmailClient(userId: string): Promise<gmail_v1.Gmail> {
    const result = await this.dataSource.query(
      `SELECT google_access_token, google_refresh_token, google_token_expiry
       FROM users WHERE id = $1`,
      [userId],
    );

    if (!result?.[0]?.google_access_token) {
      throw new UnauthorizedException(
        'Gmail niet gekoppeld. Log in met Google om je e-mails te zien.',
      );
    }

    const user = result[0];
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
    );

    oauth2Client.setCredentials({
      access_token: user.google_access_token,
      refresh_token: user.google_refresh_token,
      expiry_date: user.google_token_expiry
        ? new Date(user.google_token_expiry).getTime()
        : undefined,
    });

    // Handle token refresh
    oauth2Client.on('tokens', async (tokens) => {
      this.logger.log(`Refreshed Google tokens for user ${userId}`);
      await this.dataSource.query(
        `UPDATE users SET
          google_access_token = COALESCE($1, google_access_token),
          google_refresh_token = COALESCE($2, google_refresh_token),
          google_token_expiry = $3
        WHERE id = $4`,
        [
          tokens.access_token,
          tokens.refresh_token,
          tokens.expiry_date ? new Date(tokens.expiry_date) : null,
          userId,
        ],
      );
    });

    return google.gmail({ version: 'v1', auth: oauth2Client });
  }

  /**
   * Fetch inbox messages
   */
  async getInbox(
    userId: string,
    maxResults = 20,
    pageToken?: string,
    query?: string,
  ): Promise<GmailSyncResult> {
    const gmail = await this.getGmailClient(userId);

    const q = query || 'in:inbox';

    const listResponse = await gmail.users.messages.list({
      userId: 'me',
      maxResults,
      pageToken,
      q,
    });

    const messageIds = listResponse.data.messages || [];
    const totalCount = listResponse.data.resultSizeEstimate || 0;

    // Fetch full message details in parallel (batch of 10)
    const messages: GmailMessage[] = [];
    const batchSize = 10;

    for (let i = 0; i < messageIds.length; i += batchSize) {
      const batch = messageIds.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map((msg) =>
          gmail.users.messages
            .get({
              userId: 'me',
              id: msg.id!,
              format: 'full',
            })
            .then((res) => this.parseMessage(res.data))
            .catch((err) => {
              this.logger.warn(`Failed to fetch message ${msg.id}: ${err.message}`);
              return null;
            }),
        ),
      );

      messages.push(...batchResults.filter((m): m is GmailMessage => m !== null));
    }

    return {
      messages,
      totalCount,
      nextPageToken: listResponse.data.nextPageToken || undefined,
    };
  }

  /**
   * Get a single message by ID
   */
  async getMessage(userId: string, messageId: string): Promise<GmailMessage> {
    const gmail = await this.getGmailClient(userId);

    const response = await gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full',
    });

    return this.parseMessage(response.data);
  }

  /**
   * Get user's Gmail profile info
   */
  async getProfile(userId: string) {
    const gmail = await this.getGmailClient(userId);
    const profile = await gmail.users.getProfile({ userId: 'me' });

    return {
      email: profile.data.emailAddress,
      messagesTotal: profile.data.messagesTotal,
      threadsTotal: profile.data.threadsTotal,
    };
  }

  /**
   * Send an email reply to a message
   */
  async sendReply(
    userId: string,
    originalMessageId: string,
    threadId: string,
    to: string,
    subject: string,
    body: string,
  ) {
    const gmail = await this.getGmailClient(userId);

    // Get sender email for From header
    const profile = await gmail.users.getProfile({ userId: 'me' });
    const from = profile.data.emailAddress || '';

    // Build the Reply-To subject
    const replySubject = subject.startsWith('Re:') ? subject : `Re: ${subject}`;

    // Construct RFC 2822 email
    const emailLines = [
      `From: ${from}`,
      `To: ${to}`,
      `Subject: ${replySubject}`,
      `In-Reply-To: ${originalMessageId}`,
      `References: ${originalMessageId}`,
      `Content-Type: text/html; charset=utf-8`,
      `MIME-Version: 1.0`,
      '',
      body,
    ];

    const raw = Buffer.from(emailLines.join('\r\n'))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const result = await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw,
        threadId,
      },
    });

    this.logger.log(`Sent reply to ${to} (messageId: ${result.data.id})`);

    return {
      messageId: result.data.id,
      threadId: result.data.threadId,
    };
  }

  /**
   * Parse a Gmail API message into our format
   */
  private parseMessage(msg: gmail_v1.Schema$Message): GmailMessage {
    const headers = msg.payload?.headers || [];
    const getHeader = (name: string) =>
      headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || '';

    // Extract body
    let body = '';
    if (msg.payload?.body?.data) {
      body = Buffer.from(msg.payload.body.data, 'base64url').toString('utf-8');
    } else if (msg.payload?.parts) {
      const textPart = msg.payload.parts.find(
        (p) => p.mimeType === 'text/plain' || p.mimeType === 'text/html',
      );
      if (textPart?.body?.data) {
        body = Buffer.from(textPart.body.data, 'base64url').toString('utf-8');
      }
    }

    return {
      id: msg.id || '',
      threadId: msg.threadId || '',
      from: getHeader('From'),
      to: getHeader('To'),
      subject: getHeader('Subject'),
      snippet: msg.snippet || '',
      body,
      date: getHeader('Date'),
      isUnread: msg.labelIds?.includes('UNREAD') || false,
      labels: msg.labelIds || [],
    };
  }
}
