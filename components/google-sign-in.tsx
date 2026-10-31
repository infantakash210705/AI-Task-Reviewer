"use client";

import { signIn } from "next-auth/react";

export function GoogleSignInButton({ enabled }: { enabled: boolean }) {
  return <button className="google-button" type="button" disabled={!enabled} onClick={() => signIn("google", { callbackUrl: "/dashboard" })}>
    <span aria-hidden="true" style={{ fontSize: 17, fontWeight: 700, color: "#4285f4" }}>G</span>
    Continue with Google
  </button>;
}
