import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { StreamingModule } from '../../../../workflows/streaming/streaming.module';

@Module({
  imports: [StreamingModule],
  controllers: [ChatController],
})
export class ChatModule {}
