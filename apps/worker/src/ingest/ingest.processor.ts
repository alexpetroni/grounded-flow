import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { IngestionService } from '@app/rag';
import { DeadLetterService } from '../dead-letter.service';
import { workerConcurrency } from '../worker.config';

export const INGEST_QUEUE = 'ingest';

interface IngestJobData {
  documentId: string;
  contentBase64: string;
  mimeType: string;
  source: string;
  metadata: Record<string, unknown>;
}

@Processor(INGEST_QUEUE, { concurrency: workerConcurrency() })
export class IngestProcessor extends WorkerHost {
  private readonly logger = new Logger(IngestProcessor.name);

  constructor(
    private readonly ingestionService: IngestionService,
    private readonly deadLetter: DeadLetterService,
  ) {
    super();
  }

  async process(job: Job<IngestJobData>): Promise<void> {
    const { documentId, contentBase64, mimeType, source, metadata } = job.data;
    this.logger.log(
      `Processing ingest job for document ${documentId} (attempt ${job.attemptsMade + 1})`,
    );

    const content = Buffer.from(contentBase64, 'base64');
    await this.ingestionService.ingest({
      documentId,
      content,
      mimeType,
      source,
      metadata: metadata ?? {},
    });
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<IngestJobData> | undefined, err: Error): Promise<void> {
    if (!job) return;
    const documentId = job.data?.documentId ?? 'unknown';
    if (this.deadLetter.isTerminal(job)) {
      this.logger.error(`Ingest job failed permanently for document ${documentId}: ${err.message}`);
      await this.deadLetter.deadLetter(INGEST_QUEUE, job, err);
    } else {
      this.logger.warn(
        `Ingest job for document ${documentId} failed (attempt ${job.attemptsMade}); will retry: ${err.message}`,
      );
    }
  }
}
