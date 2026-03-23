import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { AiService } from '../ai/ai.service';

export interface AiJobData {
  conversationId: string;
  workspaceId: string;
  type: 'reply' | 'summary' | 'classification' | 'sentiment';
  instructions?: string;
}

@Processor('ai-processing')
export class AiProcessor extends WorkerHost {
  private readonly logger = new Logger(AiProcessor.name);

  constructor(private readonly aiService: AiService) {
    super();
  }

  async process(job: Job<AiJobData>): Promise<any> {
    const { conversationId, workspaceId, type, instructions } = job.data;

    this.logger.log(`Processing AI job ${job.id}: ${type} for conversation ${conversationId}`);

    try {
      const result = await this.aiService.generateSuggestion(
        conversationId,
        workspaceId,
        type,
        instructions,
      );

      this.logger.log(`AI job ${job.id} complete: suggestion ${result.id}`);
      return result;
    } catch (err) {
      this.logger.error(`AI job ${job.id} failed: ${err.message}`);
      throw err;
    }
  }
}
