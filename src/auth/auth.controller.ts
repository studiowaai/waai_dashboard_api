import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  Res,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { FastifyReply } from 'fastify';
import { IsEmail, IsString, MinLength } from 'class-validator';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { google } from 'googleapis';

class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(1)
  password: string;
}

const COOKIE_NAME = 'session';

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);
  private oauth2Client: InstanceType<typeof google.auth.OAuth2>;

  constructor(
    private authService: AuthService,
    private configService: ConfigService,
  ) {
    this.oauth2Client = new google.auth.OAuth2(
      configService.get<string>('GOOGLE_CLIENT_ID'),
      configService.get<string>('GOOGLE_CLIENT_SECRET'),
      configService.get<string>('GOOGLE_CALLBACK_URL', 'http://localhost:3000/auth/google/callback'),
    );
  }

  // ── Email/Password Login ─────────────────────────────────

  @Post('login')
  async login(@Body() loginDto: LoginDto, @Res() reply: FastifyReply) {
    const user = await this.authService.validateUser(loginDto.email, loginDto.password);

    if (!user) {
      throw new HttpException('Invalid credentials', HttpStatus.UNAUTHORIZED);
    }

    const token = this.authService.createJwt(user.id.toString(), user.org_id.toString(), user.role);
    this.setCookie(reply, token);
    reply.send({ ok: true });
  }

  @Post('logout')
  async logout(@Res() reply: FastifyReply) {
    reply.clearCookie(COOKIE_NAME, { path: '/' });
    reply.send({ ok: true });
  }

  // ── Google OAuth (manual, no Passport — Fastify compatible) ──

  @Get('google')
  async googleLogin(@Res() reply: FastifyReply) {
    const url = this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: [
        'email',
        'profile',
        'https://www.googleapis.com/auth/gmail.readonly',
      ],
    });

    this.logger.log(`Redirecting to Google consent: ${url.substring(0, 80)}...`);
    return reply.status(302).redirect(url);
  }

  @Get('google/callback')
  async googleCallback(
    @Query('code') code: string,
    @Query('error') error: string,
    @Res() reply: FastifyReply,
  ) {
    const frontendUrl = this.configService.get<string>('FRONTEND_URL', 'http://localhost:8080');

    if (error || !code) {
      this.logger.error(`Google callback error: ${error}`);
      return reply.status(302).redirect(`${frontendUrl}/login?error=google_auth_failed`);
    }

    try {
      // Exchange authorization code for tokens
      const { tokens } = await this.oauth2Client.getToken(code);
      this.oauth2Client.setCredentials(tokens);

      // Get user profile from Google
      const oauth2 = google.oauth2({ version: 'v2', auth: this.oauth2Client });
      const { data: profile } = await oauth2.userinfo.get();

      if (!profile.email) {
        throw new Error('No email in Google profile');
      }

      // Create or update user
      const user = await this.authService.handleGoogleLogin({
        googleId: profile.id || '',
        email: profile.email,
        displayName: profile.name || profile.email.split('@')[0],
        avatar: profile.picture || undefined,
        accessToken: tokens.access_token || '',
        refreshToken: tokens.refresh_token || undefined,
      });

      const token = this.authService.createJwt(
        user.id.toString(),
        user.org_id.toString(),
        user.role,
      );
      this.setCookie(reply, token);

      return reply.status(302).redirect(`${frontendUrl}/`);
    } catch (err) {
      this.logger.error(`Google OAuth error: ${err.message}`);
      return reply.status(302).redirect(`${frontendUrl}/login?error=google_auth_failed`);
    }
  }

  // ── Helpers ──────────────────────────────────────────────

  private setCookie(reply: FastifyReply, token: string) {
    const corsOrigins = this.configService.get<string>('CORS_ORIGIN', 'http://localhost:8000');
    const hasLocalhost = corsOrigins.includes('localhost') || corsOrigins.includes('127.0.0.1');
    const cookieDomain = hasLocalhost ? undefined : '.apps.studiowaai.nl';

    reply.setCookie(COOKIE_NAME, token, {
      httpOnly: true,
      secure: !hasLocalhost,
      sameSite: hasLocalhost ? 'lax' : 'none',
      domain: cookieDomain,
      path: '/',
      maxAge: 30 * 24 * 60 * 60, // 30 days
    });
  }
}
