import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { connectDB } from "@/lib/db";
import { Intern, User } from "@/lib/models";

export async function requireUser() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login");
  await connectDB();
  const user = await User.findById(session.user.id).select("_id role isActive name email image").lean();
  if (!user?.isActive) redirect("/unauthorized");
  return user;
}

export async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== "ADMIN") redirect("/unauthorized");
  return user;
}

export async function requireIntern() {
  const user = await requireUser();
  if (user.role !== "INTERN") redirect("/unauthorized");
  const intern = await Intern.findOne({ userId: user._id, status: "INACTIVE" }).select("_id").lean();
  if (intern) redirect("/unauthorized");
  return user;
}

export async function apiUser() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return { user: null, status: 401 as const };
  await connectDB();
  const user = await User.findById(session.user.id).select("_id role isActive").lean();
  if (!user?.isActive) return { user: null, status: 403 as const };
  return { user, status: 200 as const };
}
