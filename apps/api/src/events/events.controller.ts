import { Controller, Post, Get, Body, Param, HttpCode, HttpStatus } from '@nestjs/common';
import { EventsService } from './events.service';

@Controller('events')
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async create(@Body() body: unknown) {
    return this.eventsService.create(body);
  }

  @Get(':id')
  async findById(@Param('id') id: string) {
    return this.eventsService.findById(id);
  }
}
