import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { DbService } from '../database/db.service';

export interface JwtUser {
  sub: number;
  username: string;
  name: string;
  role: 'owner' | 'driver' | 'property' | 'admin';
}

@Injectable()
export class AuthService {
  constructor(
    private db: DbService,
    private jwt: JwtService,
  ) {}

  async login(username: string, password: string) {
    const { rows } = await this.db.query(
      `SELECT id, username, password_hash, name, role, phone, credit_score FROM users WHERE username=$1`,
      [username],
    );
    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      throw new UnauthorizedException('用户名或密码错误');
    }
    const payload: JwtUser = { sub: user.id, username: user.username, name: user.name, role: user.role };
    return {
      accessToken: await this.jwt.signAsync(payload),
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role,
        phone: user.phone,
        creditScore: user.credit_score,
      },
    };
  }

  async register(username: string, password: string, name: string, role: JwtUser['role'], phone?: string) {
    const hash = await bcrypt.hash(password, 10);
    try {
      const { rows } = await this.db.query(
        `INSERT INTO users(username,password_hash,name,role,phone)
         VALUES ($1,$2,$3,$4,$5) RETURNING id, username, name, role, phone, credit_score`,
        [username, hash, name, role, phone ?? null],
      );
      const user = rows[0];
      const payload: JwtUser = { sub: user.id, username: user.username, name: user.name, role: user.role };
      return {
        accessToken: await this.jwt.signAsync(payload),
        user: {
          id: user.id,
          username: user.username,
          name: user.name,
          role: user.role,
          phone: user.phone,
          creditScore: user.credit_score,
        },
      };
    } catch (e: any) {
      if (e.code === '23505') throw new UnauthorizedException('用户名已存在');
      throw e;
    }
  }
}
