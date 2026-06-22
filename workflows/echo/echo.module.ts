import { Module } from '@nestjs/common';
import { EchoNode, UpperCaseNode } from './echo.nodes';
import { EchoWorkflow } from './echo.workflow';

@Module({
  providers: [EchoNode, UpperCaseNode, EchoWorkflow],
  exports: [EchoWorkflow],
})
export class EchoModule {}
