"use client";

import { useEffect, useRef, useState } from "react";
import { X, FileDown, Loader2 } from "lucide-react";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface DownloadReportModalProps {
  address: string;
  onClose: () => void;
}

/**
 * Name/email capture modal for the public property-report download.
 * Mirrors the photo-lightbox overlay pattern used elsewhere on this page
 * (fixed inset-0 overlay, Escape-to-close, backdrop-click-to-close).
 */
export function DownloadReportModal({ address, onClose }: DownloadReportModalProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameInputRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);

    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    const nextNameError = trimmedName ? null : "Please enter your name.";
    const nextEmailError = EMAIL_RE.test(trimmedEmail) ? null : "Please enter a valid email address.";
    setNameError(nextNameError);
    setEmailError(nextEmailError);
    if (nextNameError || nextEmailError) return;

    setSubmitting(true);
    try {
      const res = await fetch("/api/property-report/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmedName, email: trimmedEmail, address }),
      });

      if (!res.ok) {
        setSubmitError(
          res.status === 404
            ? "We couldn't generate a report for this property."
            : "Something went wrong generating the report. Please try again."
        );
        return;
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${address.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "property"}-report.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      onClose();
    } catch {
      setSubmitError("Something went wrong generating the report. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Download property report"
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-[#16181D]">Download Report</h2>
            <p className="mt-1 text-sm text-[#6B7077]">
              Enter your details to download the property report for {address}.
            </p>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded-full p-1.5 text-[#8A8F97] transition-colors hover:bg-[#F4F5F7] hover:text-[#4A4E57]"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} noValidate className="mt-5 space-y-4">
          <div>
            <label htmlFor="download-report-name" className="mb-1 block text-sm font-medium text-[#4A4E57]">
              Name
            </label>
            <input
              id="download-report-name"
              ref={nameInputRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-[#E7E9EE] px-3 py-2 text-sm outline-none focus:border-[#2E5470] focus:ring-2 focus:ring-[#2E5470]/20"
              disabled={submitting}
            />
            {nameError && <p className="mt-1 text-xs text-[#C5544A]">{nameError}</p>}
          </div>

          <div>
            <label htmlFor="download-report-email" className="mb-1 block text-sm font-medium text-[#4A4E57]">
              Email
            </label>
            <input
              id="download-report-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-[#E7E9EE] px-3 py-2 text-sm outline-none focus:border-[#2E5470] focus:ring-2 focus:ring-[#2E5470]/20"
              disabled={submitting}
            />
            {emailError && <p className="mt-1 text-xs text-[#C5544A]">{emailError}</p>}
          </div>

          {submitError && (
            <p className="rounded-lg bg-[#F7E7E5] px-3 py-2 text-sm text-[#C5544A]">{submitError}</p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#2E5470] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#24435A] disabled:opacity-60"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Preparing report...
              </>
            ) : (
              <>
                <FileDown className="h-4 w-4" />
                Download Report
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
