"use client";

import { useEffect, useRef, useState } from "react";
import { X, Clock, Loader2, CheckCircle2 } from "lucide-react";
import { isValidEmail } from "@/lib/utils/report-download";

const inputClass =
  "w-full rounded-lg border border-[#E7E9EE] px-3 py-2.5 text-sm outline-none focus:border-[#2E5470] focus:ring-2 focus:ring-[#2E5470]/20";

/** "What could your property sell for?" card + enquiry modal (posts to /api/appraisal-request). */
export function AppraisalCta({ address }: { address: string }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="rounded-2xl border border-[#E7E9EE] bg-white p-6">
      <h2 className="text-lg font-semibold text-[#16181D]">What could your property sell for?</h2>
      <p className="mt-1 text-sm text-[#6B7077]">
        Connect with an agent for a no-commitment property appraisal with recommendations on sale price.
      </p>
      <button
        onClick={() => setOpen(true)}
        className="mt-4 w-full rounded-xl bg-[#2E5470] px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-[#24435A] sm:w-auto"
      >
        Get a free market appraisal
      </button>
      <p className="mt-3 flex items-center gap-1.5 text-xs text-[#6B7077]">
        <Clock className="h-3.5 w-3.5" /> 1 min to complete
      </p>
      {open && <AppraisalModal address={address} onClose={() => setOpen(false)} />}
    </section>
  );
}

function AppraisalModal({ address, onClose }: { address: string; onClose: () => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [errors, setErrors] = useState<{ name?: string; phone?: string; email?: string }>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => nameRef.current?.focus(), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    const next = {
      name: name.trim() ? undefined : "Please enter your name.",
      // Mirrors the route's AU phone check.
      phone: /^\d{8,12}$/.test(phone.replace(/[\s\-()]/g, "").replace(/^\+/, ""))
        ? undefined
        : "Please enter a valid phone number.",
      email: !email.trim() || isValidEmail(email.trim()) ? undefined : "Please enter a valid email address.",
    };
    setErrors(next);
    if (next.name || next.phone || next.email) return;

    setSubmitting(true);
    try {
      const res = await fetch("/api/appraisal-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), phone: phone.trim(), email: email.trim(), address }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setSent(true);
    } catch {
      setSubmitError("We couldn't send your request. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const field = (id: string, label: string, value: string, set: (v: string) => void, type: string, err?: string, ref?: React.Ref<HTMLInputElement>) => (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-[#4A4E57]">{label}</label>
      <input id={id} ref={ref} type={type} value={value} onChange={(e) => set(e.target.value)} className={inputClass} disabled={submitting} />
      {err && <p className="mt-1 text-xs text-[#C5544A]">{err}</p>}
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose} role="dialog" aria-modal="true" aria-label="Request a market appraisal">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-[#16181D]">Free market appraisal</h2>
            <p className="mt-1 text-sm text-[#6B7077]">{address}</p>
          </div>
          <button onClick={onClose} className="shrink-0 rounded-full p-2.5 text-[#8A8F97] hover:bg-[#F4F5F7] hover:text-[#4A4E57]" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        {sent ? (
          <div className="mt-5 flex items-start gap-2 text-sm text-[#33363D]">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#2F8F6B]" />
            Thanks — Stuart will be in touch shortly.
          </div>
        ) : (
          <form onSubmit={handleSubmit} noValidate className="mt-5 space-y-4">
            {field("appraisal-name", "Name", name, setName, "text", errors.name, nameRef)}
            {field("appraisal-phone", "Phone", phone, setPhone, "tel", errors.phone)}
            {field("appraisal-email", "Email (optional)", email, setEmail, "email", errors.email)}
            {submitError && <p className="rounded-lg bg-[#F7E7E5] px-3 py-2 text-sm text-[#C5544A]">{submitError}</p>}
            <button type="submit" disabled={submitting} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#2E5470] px-4 py-3 text-sm font-medium text-white hover:bg-[#24435A] disabled:opacity-60">
              {submitting ? <><Loader2 className="h-4 w-4 animate-spin" /> Sending...</> : "Request appraisal"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
