import { Controller, Post, Body, BadRequestException } from '@nestjs/common';
import { RagQueryService, type RagQueryResult } from '@app/rag';
import { RagQueryDto } from './rag-query.dto';

@Controller('rag')
export class RagController {
  constructor(private readonly ragQueryService: RagQueryService) {}

  @Post('query')
  async query(@Body() body: unknown): Promise<RagQueryResult> {
    const parsed = RagQueryDto.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }
    return this.ragQueryService.query(parsed.data);
  }
}
