import 'server-only';

import type { AuthOptions, Session } from 'next-auth';
import { PrismaAdapter } from '@auth/prisma-adapter';
import { prisma } from '@/lib/core/prisma';
import type { JWT } from 'next-auth/jwt';

type OsuProfile = {
  id: number;
  username: string;
  avatar_url?: string;
  country_code?: string;
};

type OsuOAuthAccount = {
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;
};

type OsuUser = {
  osuId?: number;
};

export const authOptions: AuthOptions = {
  adapter: PrismaAdapter(prisma) as unknown as AuthOptions['adapter'],
  providers: [
    {
      id: 'osu',
      name: 'osu!',
      type: 'oauth',
      authorization: {
        url: 'https://osu.ppy.sh/oauth/authorize',
        params: { scope: 'identify public' },
      },
      token: 'https://osu.ppy.sh/oauth/token',
      userinfo: 'https://osu.ppy.sh/api/v2/me/osu',
      clientId: process.env.OSU_CLIENT_ID!,
      clientSecret: process.env.OSU_CLIENT_SECRET!,
      profile(profile: OsuProfile) {
        return {
          id: profile.id.toString(),
          osuId: profile.id,
          osuUsername: profile.username,
          avatarUrl: profile.avatar_url,
          countryCode: profile.country_code,
        };
      },
    } as unknown as AuthOptions['providers'][number],
  ],
  callbacks: {
    async jwt({ token, account, user }: { token: JWT; account: unknown; user: unknown }) {
      const accountData = (account ?? null) as OsuOAuthAccount | null;
      const userData = (user ?? null) as OsuUser | null;

      if (accountData && userData) {
        (token as unknown as { accessToken?: string }).accessToken = accountData.access_token;
        (token as unknown as { refreshToken?: string }).refreshToken = accountData.refresh_token;
        (token as unknown as { tokenExpiry?: number }).tokenExpiry = accountData.expires_at;
        (token as unknown as { osuId?: number }).osuId = userData.osuId;
      }
      return token;
    },
    async session({ session, token }: { session: Session; token: JWT }) {
      if (token && session.user) {
        const userSession = session.user as unknown as { osuId?: number };
        userSession.osuId = (token as unknown as { osuId?: number }).osuId;
      }
      return session;
    },
  },
  events: {
    async signIn({ user, account }: { user: unknown; account: unknown }) {
      const accountData = (account ?? null) as OsuOAuthAccount | null;
      const userData = (user ?? null) as OsuUser | null;

      if (accountData && userData?.osuId) {
        await prisma.user.update({
          where: { osuId: userData.osuId },
          data: {
            accessToken: accountData.access_token,
            refreshToken: accountData.refresh_token,
            tokenExpiry: accountData.expires_at ? new Date(accountData.expires_at * 1000) : null,
            lastLoginAt: new Date(),
          },
        });
      }
    },
  },
  pages: {
    signIn: '/login',
    error: '/auth/error',
  },
  session: {
    strategy: 'jwt',
  },
};
