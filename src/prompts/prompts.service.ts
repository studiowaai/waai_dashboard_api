import {
  Injectable,
  NotFoundException,
  BadRequestException,
  BadGatewayException,
  GatewayTimeoutException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { AxiosError } from 'axios';
import FormData from 'form-data';

@Injectable()
export class PromptsService {
  private readonly logger = new Logger(PromptsService.name);

  constructor(
    @InjectDataSource() private dataSource: DataSource,
    private httpService: HttpService,
  ) {}

  async getOrgWebhookUrls(orgId: string) {
    const query = `
      SELECT n8n_transcribe_webhook_url, n8n_prompt_webhook_url
      FROM organizations
      WHERE id = $1
    `;

    const result = await this.dataSource.query(query, [orgId]);

    if (!result || result.length === 0) {
      throw new NotFoundException('Organization not found');
    }

    const row = result[0];

    return {
      transcribeUrl: row.n8n_transcribe_webhook_url,
      promptUrl: row.n8n_prompt_webhook_url,
    };
  }

  async transcribeAudio(orgId: string, userId: string, audioBuffer: Buffer, filename: string) {
    const urls = await this.getOrgWebhookUrls(orgId);

    if (!urls.transcribeUrl) {
      throw new BadRequestException(
        'Transcription webhook URL not configured for your organization. Please contact administrator.',
      );
    }

    try {
      this.logger.log(
        `Transcribing audio for org ${orgId}, file: ${filename}, size: ${audioBuffer.length} bytes`,
      );

      const formData = new FormData();
      formData.append('audio', audioBuffer, {
        filename,
        contentType: 'audio/mpeg',
      });
      formData.append('org_id', orgId);
      formData.append('user_id', userId);

      const response = await firstValueFrom(
        this.httpService.post(urls.transcribeUrl, formData, {
          timeout: 60000,
          headers: formData.getHeaders(),
        }),
      );

      if (response.status === 200) {
        const result = response.data;
        const transcription = result.transcription || result.text || '';

        if (!transcription) {
          this.logger.warn(`Empty transcription from n8n for org ${orgId}`);
          return {
            ok: false,
            transcription: '',
            message: 'Transcription returned empty. Please try again.',
          };
        }

        this.logger.log(`Transcription successful for org ${orgId}`);
        return {
          ok: true,
          transcription,
        };
      } else {
        this.logger.error(
          `n8n transcription webhook failed: ${response.status} - ${response.data}`,
        );
        throw new BadGatewayException(`Transcription service returned error: ${response.status}`);
      }
    } catch (error) {
      if (error instanceof AxiosError) {
        if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
          this.logger.error(`Transcription timeout for org ${orgId}`);
          throw new GatewayTimeoutException('Transcription service timed out. Please try again.');
        }
        this.logger.error(`Transcription request error for org ${orgId}: ${error.message}`);
        throw new BadGatewayException('Failed to connect to transcription service');
      }

      this.logger.error(`Unexpected error during transcription for org ${orgId}: ${error}`);
      throw new InternalServerErrorException('An unexpected error occurred during transcription');
    }
  }

  async submitPrompt(orgId: string, userId: string, promptText: string, target: string) {
    const urls = await this.getOrgWebhookUrls(orgId);

    if (!urls.promptUrl) {
      throw new BadRequestException(
        'Prompt webhook URL not configured for your organization. Please contact administrator.',
      );
    }

    try {
      this.logger.log(`Submitting prompt for org ${orgId}, target: ${target}`);

      const payload = {
        prompt_text: promptText,
        target,
        org_id: orgId,
        user_id: userId,
      };

      const response = await firstValueFrom(
        this.httpService.post(urls.promptUrl, payload, {
          timeout: 30000,
        }),
      );

      if (response.status === 200) {
        this.logger.log(`Prompt submitted successfully for org ${orgId}`);
        return {
          ok: true,
          message: 'Prompt submitted successfully. An approval will be created shortly.',
        };
      } else {
        this.logger.error(`n8n prompt webhook failed: ${response.status} - ${response.data}`);
        throw new BadGatewayException(`Prompt service returned error: ${response.status}`);
      }
    } catch (error) {
      if (error instanceof AxiosError) {
        if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
          this.logger.error(`Prompt submission timeout for org ${orgId}`);
          throw new GatewayTimeoutException('Prompt service timed out. Please try again.');
        }
        this.logger.error(`Prompt submission request error for org ${orgId}: ${error.message}`);
        throw new BadGatewayException('Failed to connect to prompt service');
      }

      this.logger.error(`Unexpected error during prompt submission for org ${orgId}: ${error}`);
      throw new InternalServerErrorException(
        'An unexpected error occurred during prompt submission',
      );
    }
  }
}
