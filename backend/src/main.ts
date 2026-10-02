import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from './app.module';
import { runSeed } from './seed-data';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api', { exclude: [] });
  app.enableCors();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  const port = parseInt(process.env.PORT || '3000', 10);
  await app.listen(port, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`Shared parking API listening on http://0.0.0.0:${port}/api`);

  // 一键演示：SEED_ON_BOOT=true 时启动后自动播种（幂等，会重建演示数据）
  if (process.env.SEED_ON_BOOT === 'true') {
    try {
      const ds = app.get(DataSource);
      await runSeed(ds);
    } catch (e) {
      console.error('Boot seed failed:', e);
    }
  }
}
bootstrap();
