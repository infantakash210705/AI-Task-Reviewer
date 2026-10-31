import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { MongoDBAdapter } from "@next-auth/mongodb-adapter";
import clientPromise from "@/lib/mongodb";
import { connectDB } from "@/lib/db";
import { User } from "@/lib/models";

const googleClientId = process.env.GOOGLE_CLIENT_ID;
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;

export const authOptions: NextAuthOptions = {
  adapter: clientPromise ? MongoDBAdapter(clientPromise, { collections: { Users: "auth_users", Accounts: "auth_accounts", Sessions: "auth_sessions", VerificationTokens: "auth_verification_tokens" } }) : undefined,
  providers: [
    GoogleProvider({
      clientId: googleClientId || "missing-google-client-id",
      clientSecret: googleClientSecret || "missing-google-client-secret",
      authorization: { params: { prompt: "select_account", access_type: "offline", response_type: "code" } },
    }),
  ],
  pages: { signIn: "/login", error: "/login" },
  session: { strategy: clientPromise ? "database" : "jwt" },
  callbacks: {
    async signIn({ user, account }) {
      if (!user.email || !account?.providerAccountId || !googleClientId || !googleClientSecret) return false;
      await connectDB();
      const normalizedEmail = user.email.trim().toLowerCase();
      const existing = await User.findOne({ providerAccountId: account.providerAccountId });
      if (existing && !existing.isActive) return false;
      const configuredAdminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
      const role = existing?.role === "ADMIN" || (configuredAdminEmail && normalizedEmail === configuredAdminEmail) ? "ADMIN" : "INTERN";
      await User.findOneAndUpdate(
        { providerAccountId: account.providerAccountId },
        { $set: { name: user.name || normalizedEmail, email: normalizedEmail, normalizedEmail, image: user.image || "", role }, $setOnInsert: { isActive: true } },
        { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
      );
      return true;
    },
    async session({ session }) {
      if (!session.user?.email) return session;
      await connectDB();
      const dbUser = await User.findOne({ normalizedEmail: session.user.email.trim().toLowerCase() }).select("_id role isActive").lean();
      if (dbUser) {
        session.user.id = String(dbUser._id);
        session.user.role = dbUser.role;
        session.user.isActive = dbUser.isActive;
      }
      return session;
    },
  },
  cookies: {
    sessionToken: {
      name: process.env.NODE_ENV === "production" ? "__Secure-next-auth.session-token" : "next-auth.session-token",
      options: { httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production" },
    },
  },
};
