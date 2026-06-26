import { Global, Module } from '@nestjs/common';
import { DeadLetterService } from './dead-letter.service';

@Global()
@Module({
  providers: [DeadLetterService],
  exports: [DeadLetterService],
})
export class DeadLetterModule {}
