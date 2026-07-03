import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { StreamingModule } from '@app/workflows';

@Module({
  imports: [StreamingModule],
  controllers: [ChatController],
})
export class ChatModule {}
