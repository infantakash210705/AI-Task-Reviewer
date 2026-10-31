import { connectDB } from "@/lib/db";
import { Intern, User } from "@/lib/models";
import { InternCreateForm } from "@/components/admin-forms";
import { InternTable } from "@/components/record-tables";

export const dynamic = "force-dynamic";

type Candidate = {
  _id?: unknown;
  name?: string;
  email?: string;
};

export default async function AdminInternsPage() {
  await connectDB();
  const [interns, existing] = await Promise.all([
    Intern.find({}).populate({ path: "userId", select: "name email image" }).sort({ createdAt: -1 }).limit(50).lean(),
    Intern.distinct("userId"),
  ]);
  const candidates = await User.find({ role: "INTERN", isActive: true, _id: { $nin: existing } }).select("_id name email").sort({ name: 1 }).limit(100).lean();
  return <>
    <div className="page-heading"><div><h1>Interns</h1><p>Manage profiles linked to authenticated intern accounts.</p></div></div>
    <InternCreateForm candidates={JSON.parse(JSON.stringify(candidates.map((candidate: Candidate) => ({ id: String(candidate._id), name: candidate.name || "Intern", email: candidate.email || "" }))))} />
    <section className="card"><div className="card-header"><div className="card-title">Intern directory</div><span className="badge">{interns.length} shown</span></div><InternTable items={JSON.parse(JSON.stringify(interns))} /></section>
  </>;
}
