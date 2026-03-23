import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { GmailSyncService } from '../inbox/gmail-sync.service';

export interface GmailSyncJobData {
  userId: string;
  workspaceId: string;
  maxResults?: number;
}

@Processor('gmail-sync')
export class GmailSyncProcessor extends WorkerHost {
  private readonly logger = new Logger(GmailSyncProcessor.name);

  constructor(private readonly gmailSyncService: GmailSyncService) {
    super();
  }

  async process(job: Job<GmailSyncJobData>): Promise<any> {
    const { userId, workspaceId, maxResults } = job.data;

    this.logger.log(`Processing Gmail sync job ${job.id} for user ${userId}`);

    try {
      const result = await this.gmailSyncService.syncInbox(userId, workspaceId, maxResults || 50);

      this.logger.log(
        `Gmail sync job ${job.id} complete: ${result.synced} synced, ${result.errors} errors`,
      );

      return result;
    } catch (err) {
      this.logger.error(`Gmail sync job ${job.id} failed: ${err.message}`);
      throw err;
    }
  }
}
