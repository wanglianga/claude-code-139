import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './modules/auth/auth.module';
import { ParkingModule } from './modules/parking/parking.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      username: process.env.DB_USER || 'parking',
      password: process.env.DB_PASSWORD || 'parking',
      database: process.env.DB_NAME || 'shared_parking',
      autoLoadEntities: true,
      synchronize: true, // 演示工程：自动建表；生产应使用迁移
      logging: false,
    }),
    AuthModule,
    ParkingModule,
  ],
})
export class AppModule {}
