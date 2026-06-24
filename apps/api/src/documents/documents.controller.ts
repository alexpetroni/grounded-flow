import { Controller, Post, Get, Body, Param, HttpCode, HttpStatus } from '@nestjs/common';
import { DocumentsService } from './documents.service';

@Controller('documents')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async create(@Body() body: unknown) {
    return this.documentsService.create(body);
  }

  @Get(':id')
  async findById(@Param('id') id: string) {
    return this.documentsService.findById(id);
  }
}
