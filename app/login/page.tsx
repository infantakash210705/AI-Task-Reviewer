import { getServerSession, type Session } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { Brand } from "@/components/brand";
import { GoogleSignInButton } from "@/components/google-sign-in";

function isMongoConnectionError(error: unknown): boolean {
  if (!error) return false;
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current; depth += 1) {
    if (typeof current === "object" && current !== null) {
      const name = "name" in current && typeof current.name === "string" ? current.name : "";
      const message = "message" in current && typeof current.message === "string" ? current.message : "";
      const code = "code" in current ? String(current.code) : "";

      if (
        [
          "MongoServerSelectionError",
          "MongooseServerSelectionError",
          "MongoNetworkError",
          "MongoNetworkTimeoutError",
          "MongoTimeoutError",
        ].includes(name)
      ) {
        return true;
      }

      const combined = `${name} ${message} ${code}`.toLowerCase();
      if (
        combined.includes("ssl alert") ||
        combined.includes("tlsv1 alert") ||
        combined.includes("mongoserverselectionerror") ||
        combined.includes("mongonetworkerror") ||
        combined.includes("connection closed") ||
        combined.includes("socket hang up") ||
        combined.includes("econnrefused") ||
        combined.includes("timed out")
      ) {
        return true;
      }

      current = "cause" in current ? current.cause : null;
    } else if (typeof current === "string") {
      const lower = current.toLowerCase();
      return (
        lower.includes("ssl alert") ||
        lower.includes("tlsv1 alert") ||
        lower.includes("mongo") ||
        lower.includes("timed out")
      );
    } else {
      break;
    }
  }
  return false;
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  let session: Session | null = null;
  let databaseUnavailable = false;
  try {
    session = await getServerSession(authOptions);
  } catch (sessionError) {
    if (!isMongoConnectionError(sessionError)) {
      console.error("[auth] Unexpected session error on login page:", sessionError);
      throw sessionError;
    }
    databaseUnavailable = true;
    console.error("[auth] MongoDB connection failed while loading the sign-in session.", sessionError);
  }
  if (session?.user?.role === "ADMIN") redirect("/admin");
  if (session?.user) redirect("/intern");
  const configured = Boolean(process.env.MONGODB_URI && process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.NEXTAUTH_SECRET);
  return (
    <main className="login-page">
      <section className="login-panel">
        <Brand />
        <div className="login-content">
          <div className="eyebrow">Internship &amp; Project Management</div>
          <h1>Build skills.<br />Make an impact.</h1>
          <p className="subtle">Your workspace for internship projects, task progress, and meaningful feedback.</p>
          <GoogleSignInButton enabled={configured && !databaseUnavailable} />
          {!configured && <div className="setup-note" role="status">Google sign-in is not configured yet. An administrator needs to set MongoDB and Google OAuth environment variables before access can be enabled.</div>}
          {databaseUnavailable && <div className="setup-note" role="alert">MongoDB Atlas is not reachable, so sign-in is temporarily unavailable. Check that the cluster is running, your current IP is allowed in Atlas Network Access, and the connection string was copied from Atlas&apos; Drivers page. Do not disable TLS verification.</div>}
          {error && <div className="setup-note" role="alert">Sign-in could not be completed. Check the Google OAuth and MongoDB configuration, then try again.</div>}
          <p className="subtle" style={{ fontSize: 12, marginTop: 15 }}>Access is managed by your organization. Administrators are assigned through the configured bootstrap identity.</p>
        </div>
        <div className="login-footer">© {new Date().getFullYear()} Shortfundly InternFlow</div>
      </section>
      <aside className="login-art">
        <div className="art-copy">
          <div className="eyebrow" style={{ color: "#9fb3ff" }}>A clearer path from learning to delivery</div>
          <h2>Every project is a step forward.</h2>
          <p style={{ color: "#b8c4d8", lineHeight: 1.7 }}>A focused home for internship work—so teams can share expectations, track progress, and keep feedback connected to the work.</p>
          <div className="art-card"><div style={{ fontSize: 12, fontWeight: 700, marginBottom: 7 }}>One workspace. Clear next steps.</div><div style={{ fontSize: 12, color: "#b8c4d8" }}>Tasks, submissions, and review history stay together throughout the internship.</div></div>
        </div>
      </aside>
    </main>
  );
}
