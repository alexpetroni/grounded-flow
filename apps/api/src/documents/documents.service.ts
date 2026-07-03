import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import type { Queue } from 'bullmq';
import { DocumentsRepository } from '@app/database';
import type { Document } from '@app/database';
import { INGEST_QUEUE } from '@app/core';
import type { Env } from '@app/config';
import { SUPPORTED_MIME_TYPES } from '@app/rag';
import { enqueueJob } from '../common/enqueue-job';
import { parseOrThrow } from '../common/validate-body';
import { CreateDocumentDto as CreateDocumentSchema } from './documents.dto';

export interface IngestJobData {
  documentId: string;
  contentBase64: string;
  mimeType: string;
  source: string;
  metadata: Record<string, unknown>;
}

@Injectable()
export class DocumentsService {
  constructor(
    private readonly documentsRepository: DocumentsRepository,
    @InjectQueue(INGEST_QUEUE) private readonly ingestQueue: Queue<IngestJobData>,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async create(body: unknown): Promise<{ id: string; status: string }> {
    const dto = parseOrThrow(CreateDocumentSchema, body);

    if (!SUPPORTED_MIME_TYPES.includes(dto.mimeType as (typeof SUPPORTED_MIME_TYPES)[number])) {
      throw new BadRequestException(`Unsupported MIME type: ${dto.mimeType}`);
    }

    const doc = await this.documentsRepository.create({
      source: dto.source,
      mimeType: dto.mimeType,
      metadata: dto.metadata,
    });

    await enqueueJob(
      this.ingestQueue,
      'ingest',
      {
        documentId: doc.id,
        contentBase64: dto.content,
        mimeType: dto.mimeType,
        source: dto.source,
        metadata: dto.metadata,
      },
      this.config,
    );

    return { id: doc.id, status: doc.status };
  }

  async findById(id: string): Promise<Document> {
    const doc = await this.documentsRepository.findById(id);
    if (!doc) throw new NotFoundException(`Document ${id} not found`);
    return doc;
  }
}
