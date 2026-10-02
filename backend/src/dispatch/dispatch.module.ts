import { Module } from '@nestjs/common';
import { DispatchController } from './dispatch.controller';

@Module({
  controllers: [DispatchController],
})
export class DispatchModule {}
