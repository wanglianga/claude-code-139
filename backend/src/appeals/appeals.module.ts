import { Module } from '@nestjs/common';
import { AppealsController } from './appeals.controller';

@Module({
  controllers: [AppealsController],
})
export class AppealsModule {}
