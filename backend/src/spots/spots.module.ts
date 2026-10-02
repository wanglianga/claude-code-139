import { Module } from '@nestjs/common';
import { SpotsController } from './spots.controller';

@Module({
  controllers: [SpotsController],
})
export class SpotsModule {}
