import { Injectable, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback, Profile } from 'passport-google-oauth20';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  private readonly logger = new Logger(GoogleStrategy.name);

  constructor(
    private configService: ConfigService,
    private authService: AuthService,
  ) {
    const clientID = configService.get<string>('GOOGLE_CLIENT_ID', '');
    const clientSecret = configService.get<string>('GOOGLE_CLIENT_SECRET', '');

    super({
      clientID: clientID || 'not-configured',
      clientSecret: clientSecret || 'not-configured',
      callbackURL: configService.get<string>(
        'GOOGLE_CALLBACK_URL',
        'http://localhost:3000/auth/google/callback',
      ),
      scope: ['email', 'profile', 'https://www.googleapis.com/auth/gmail.readonly'],
      accessType: 'offline',
      prompt: 'consent',
    });

    if (!clientID || !clientSecret) {
      new Logger(GoogleStrategy.name).warn(
        '⚠️  GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set — Google OAuth will fail at runtime',
      );
    }
  }

  async validate(
    accessToken: string,
    refreshToken: string,
    profile: Profile,
    done: VerifyCallback,
  ): Promise<void> {
    this.logger.log(`Google OAuth callback for: ${profile.emails?.[0]?.value}`);

    try {
      const user = await this.authService.handleGoogleLogin({
        googleId: profile.id,
        email: profile.emails?.[0]?.value || '',
        displayName: profile.displayName,
        avatar: profile.photos?.[0]?.value,
        accessToken,
        refreshToken,
      });

      done(null, user);
    } catch (err) {
      this.logger.error(`Google OAuth error: ${err.message}`);
      done(err, false);
    }
  }
}
