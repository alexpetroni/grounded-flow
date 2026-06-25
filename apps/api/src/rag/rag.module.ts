import { Module } from '@nestjs/common';
import { RagModule as RagLibModule } from '@app/rag';
import { RagController } from './rag.controller';

@Module({
  imports: [RagLibModule],
  controllers: [RagController],
})
export class RagApiModule {}
