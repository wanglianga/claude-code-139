import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, QueryResultRow } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class DbService implements OnModuleInit {
  public readonly pool: Pool;

  constructor(private config: ConfigService) {
    this.pool = new Pool({
      host: this.config.get<string>('DB_HOST', '127.0.0.1'),
      port: Number(this.config.get<string>('DB_PORT', '5432')),
      user: this.config.get<string>('DB_USER', 'postgres'),
      password: this.config.get<string>('DB_PASSWORD', ''),
      database: this.config.get<string>('DB_NAME', 'parking'),
      max: 10,
    });
  }

  async onModuleInit() {
    const candidates = [
      path.join(__dirname, 'schema.sql'),
      path.join(__dirname, '..', '..', 'src', 'database', 'schema.sql'),
    ];
    const file = candidates.find((p) => fs.existsSync(p));
    if (!file) throw new Error('schema.sql not found in: ' + candidates.join(', '));
    const schema = fs.readFileSync(file, 'utf8');
    await this.pool.query(schema);
  }

  query<T extends QueryResultRow = any>(text: string, params: any[] = []) {
    return this.pool.query<T>(text, params);
  }

  async withTx<T>(fn: (client: import('pg').PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
}
