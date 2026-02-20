import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';

export interface JwtPayload {
  sub: string;
  org: string;
  role: string;
}

@Injectable()
export class AuthService {
  constructor(
    @InjectDataSource()
    private dataSource: DataSource,
    private jwtService: JwtService,
  ) {}

  async hashPassword(plain: string): Promise<string> {
    const saltRounds = 10;
    return bcrypt.hash(plain, saltRounds);
  }

  async verifyPassword(plain: string, hashed: string): Promise<boolean> {
    return bcrypt.compare(plain, hashed);
  }

  createJwt(userId: string, orgId: string, role: string): string {
    const payload: JwtPayload = {
      sub: userId,
      org: orgId,
      role,
    };
    return this.jwtService.sign(payload);
  }

  async validateUser(email: string, password: string) {
    const result = await this.dataSource.query(
      'SELECT id, org_id, role, password_hash FROM users WHERE email = $1',
      [email],
    );

    if (!result || result.length === 0) {
      return null;
    }

    const user = result[0];
    const isValid = await this.verifyPassword(password, user.password_hash);

    if (!isValid) {
      return null;
    }

    return {
      id: user.id,
      org_id: user.org_id,
      role: user.role,
    };
  }
}
