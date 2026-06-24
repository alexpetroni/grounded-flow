import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { DocumentsRepository } from '@app/database';
import type { Document } from '@app/database';
import { SUPPORTED_MIME_TYPES } from '@app/rag';
import type { CreateDocumentDto } from './documents.dto';
import { CreateDocumentDto as CreateDocumentSchema } from './documents.dto';

export const INGEST_QUEUE = 'ingest';

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
  ) {}

  async create(body: unknown): Promise<{ id: string; status: string }> {
    const parseResult = CreateDocumentSchema.safeParse(body);
    if (!parseResult.success) {
      throw new BadRequestException(parseResult.error.flatten());
    }
    const dto: CreateDocumentDto = parseResult.data;

    if (!SUPPORTED_MIME_TYPES.includes(dto.mimeType as (typeof SUPPORTED_MIME_TYPES)[number])) {
      throw new BadRequestException(`Unsupported MIME type: ${dto.mimeType}`);
    }

    const doc = await this.documentsRepository.create({
      source: dto.source,
      mimeType: dto.mimeType,
      metadata: dto.metadata,
    });

    await this.ingestQueue.add(
      'ingest',
      {
        documentId: doc.id,
        contentBase64: dto.content,
        mimeType: dto.mimeType,
        source: dto.source,
        metadata: dto.metadata,
      },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    );

    return { id: doc.id, status: doc.status };
  }

  async findById(id: string): Promise<Document> {
    const doc = await this.documentsRepository.findById(id);
    if (!doc) throw new NotFoundException(`Document ${id} not found`);
    return doc;
  }
}
