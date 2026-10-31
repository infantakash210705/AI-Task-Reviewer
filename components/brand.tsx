import { Layers3 } from "lucide-react";

export function Brand({ light = false }: { light?: boolean }) {
  return (
    <div className={`brand${light ? " brand-light" : ""}`}>
      <span className="brand-icon"><Layers3 size={19} strokeWidth={2.3} /></span>
      <span>Shortfundly <span style={{ fontWeight: 450, opacity: .75 }}>InternFlow</span></span>
    </div>
  );
}
