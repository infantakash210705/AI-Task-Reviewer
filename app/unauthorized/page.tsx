import Link from "next/link";

export default function UnauthorizedPage() {
  return <main style={{ maxWidth: 520, margin: "12vh auto", padding: 24 }}><div className="eyebrow">Access restricted</div><h1 style={{ color: "#14233b" }}>You don&apos;t have access to this page.</h1><p className="subtle">Your account may not have the required role, or it may have been deactivated. Contact your program administrator if you think this is a mistake.</p><Link className="button button-primary" href="/login">Return to sign in</Link></main>;
}
