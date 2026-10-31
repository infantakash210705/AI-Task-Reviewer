import { redirect } from "next/navigation";
import { requireUser } from "@/lib/authz";

export default async function DashboardRedirect() {
  const user = await requireUser();
  redirect(user.role === "ADMIN" ? "/admin" : "/intern");
}
