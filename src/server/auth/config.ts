import { DrizzleAdapter } from '@auth/drizzle-adapter'
import type { DefaultSession, NextAuthConfig } from 'next-auth'
import DiscordProvider from 'next-auth/providers/discord'

import { normalizePermissions, type PermissionKey } from '@/lib/permissions'
import { db } from '@/server/db'
import {
  accounts,
  sessions,
  users,
  verificationTokens,
} from '@/server/db/schema'

type SessionUserFields = {
  discord_id?: string
  permissions?: PermissionKey[]
}
/**
 * Module augmentation for `next-auth` types. Allows us to add custom properties to the `session`
 * object and keep type safety.
 *
 * @see https://next-auth.js.org/getting-started/typescript#module-augmentation
 */
declare module 'next-auth' {
  interface Session extends DefaultSession {
    user: {
      id: string
      discord_id: string
      permissions: PermissionKey[]
    } & DefaultSession['user']
  }
}

/**
 * Options for NextAuth.js used to configure adapters, providers, callbacks, etc.
 *
 * @see https://next-auth.js.org/configuration/options
 */
export const authConfig = {
  providers: [
    DiscordProvider({
      profile(profile) {
        if (profile.avatar === null) {
          const defaultAvatarNumber =
            profile.discriminator === '0'
              ? Number(BigInt(profile.id) >> BigInt(22)) % 6
              : Number.parseInt(profile.discriminator, 10) % 5
          profile.image_url = `https://cdn.discordapp.com/embed/avatars/${defaultAvatarNumber}.png`
        } else {
          const format = profile.avatar.startsWith('a_') ? 'gif' : 'png'
          profile.image_url = `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.${format}`
        }
        return {
          id: profile.id,
          name: profile.global_name ?? profile.username,
          email: profile.email ?? null,
          image: profile.image_url,
          discord_id: profile.id.toString(),
        }
      },
    }),
    /**
     * ...add more providers here.
     *
     * Most other providers require a bit more work than the Discord provider. For example, the
     * GitHub provider requires you to add the `refresh_token_expires_in` field to the Account
     * model. Refer to the NextAuth.js docs for the provider you want to use. Example:
     *
     * @see https://next-auth.js.org/providers/github
     */
  ],
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  callbacks: {
    session: ({ session, user }) => {
      const typedUser = user as typeof user & SessionUserFields
      const typedSessionUser = session.user as typeof session.user &
        SessionUserFields

      return {
        ...session,
        user: {
          ...session.user,
          id: user.id,
          discord_id:
            typedUser.discord_id ?? typedSessionUser.discord_id ?? user.id,
          permissions: normalizePermissions(
            typedUser.permissions ?? typedSessionUser.permissions
          ),
        },
      }
    },
  },
} satisfies NextAuthConfig
