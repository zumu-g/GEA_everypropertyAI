"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Database, MapPin, BarChart3 } from "lucide-react";
import { AddressSearch } from "@/components/search/AddressSearch";
import { AuthButton } from "@/components/auth/AuthButton";

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return reduced;
}

const trustSignals = [
  { icon: MapPin, label: "Casey & Cardinia", description: "Hyper-local focus" },
  { icon: Database, label: "8+ Data Portals", description: "Aggregated in real time" },
  { icon: BarChart3, label: "Instant Results", description: "Quick sign-in via email" },
];

export default function HomePage() {
  const reduced = usePrefersReducedMotion();

  function fadeUp(delay = 0) {
    if (reduced) return {};
    return {
      initial: { opacity: 0, y: 20 },
      animate: { opacity: 1, y: 0 },
      transition: { duration: 0.4, ease: "easeOut", delay },
    };
  }

  return (
    <div className="flex min-h-screen flex-col bg-[#FBFBFC]">
      {/* ── Navigation ── */}
      <header className="sticky top-0 z-40 border-b border-[#E7E9EE] bg-[#FBFBFC]/90 backdrop-blur-sm pt-safe px-safe">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <a href="/" className="flex items-center gap-3 group" aria-label="everypropertyAI home">
            {/* GEA monogram */}
            <span
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#16181D] text-xs font-medium tracking-wide text-[#2E5470] transition-opacity duration-150 group-hover:opacity-80"
              aria-hidden="true"
            >
              GEA
            </span>
            <div className="leading-none">
              <span
                className="block text-[1.1rem] leading-tight tracking-tight text-[#16181D]"
              >
                everyproperty<span className="text-[#2E5470]">AI</span>
              </span>
              <span className="block text-[0.65rem] text-[#6B7077] tracking-wide uppercase">
                by Grants Estate Agents
              </span>
            </div>
          </a>

          <nav aria-label="Site navigation" className="flex items-center gap-3">
            <a
              href="mailto:info@grantse.com.au"
              className="rounded-lg border border-[#E7E9EE] bg-white px-4 py-2 text-sm font-medium text-[#16181D] transition-all duration-150 hover:border-[#2E5470] hover:text-[#2E5470] focus:outline-none focus:ring-2 focus:ring-[#2E5470] focus:ring-offset-2"
            >
              Contact
            </a>
            <AuthButton />
          </nav>
        </div>
      </header>

      {/* ── Hero ── */}
      <main className="flex flex-1 flex-col">
        {/* Faint cool backdrop */}
        <div
          className="absolute inset-x-0 top-0 h-[600px] pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse 80% 60% at 50% -10%, rgba(51,92,125,0.05) 0%, transparent 70%)",
          }}
          aria-hidden="true"
        />

        <section className="relative mx-auto flex w-full max-w-5xl flex-col items-center px-6 pb-20 pt-24 text-center sm:pt-32">
          {/* Eyebrow */}
          <motion.div {...fadeUp(0)}>
            <span className="inline-flex items-center gap-2 rounded-full border border-[#E7E9EE] bg-[#F4F5F7] px-4 py-1.5 text-xs font-medium text-[#6B7077] tracking-wide uppercase">
              <span className="h-1.5 w-1.5 rounded-full bg-[#2E5470]" aria-hidden="true" />
              Casey &amp; Cardinia — Victoria
            </span>
          </motion.div>

          {/* Headline */}
          <motion.h1
            {...fadeUp(0.08)}
            className="text-display mt-7 max-w-3xl text-[#16181D]"
          >
            Every property.{" "}
            <span className="text-[#2E5470]">Every detail.</span>
          </motion.h1>

          {/* Sub-heading */}
          <motion.p
            {...fadeUp(0.16)}
            className="mt-6 max-w-lg text-[1.0625rem] leading-relaxed text-[#6B7077]"
          >
            Search any property across Casey &amp; Cardinia.{" "}
            Instant data from 8+ portals, no sign-up required.
          </motion.p>

          {/* Search */}
          <motion.div
            {...fadeUp(0.24)}
            className="mt-10 w-full max-w-2xl"
          >
            <AddressSearch size="lg" />
          </motion.div>

          {/* Trust signals */}
          <motion.div
            {...fadeUp(0.36)}
            className="mt-20 grid w-full max-w-3xl grid-cols-1 divide-y divide-[#E7E9EE] border-t border-[#E7E9EE] sm:grid-cols-3 sm:divide-x sm:divide-y-0"
          >
            {trustSignals.map(({ icon: Icon, label, description }) => (
              <div
                key={label}
                className="flex items-center gap-3 py-5 sm:flex-col sm:items-center sm:gap-1.5 sm:px-6 sm:text-center"
              >
                <Icon className="h-4 w-4 shrink-0 text-[#8A8F97]" aria-hidden="true" />
                <div className="sm:space-y-0.5">
                  <p className="text-sm font-medium text-[#16181D]">{label}</p>
                  <p className="text-xs text-[#6B7077]">{description}</p>
                </div>
              </div>
            ))}
          </motion.div>
        </section>

        {/* ── Footer strip ── */}
        <footer className="mt-auto border-t border-[#E7E9EE] py-6 text-center">
          <p className="text-xs text-[#6B7077]">
            &copy; {new Date().getFullYear()} Grants Estate Agents &middot;{" "}
            <span className="text-[#2E5470]">everypropertyAI</span> &mdash; Property data for Casey &amp; Cardinia
          </p>
        </footer>
      </main>
    </div>
  );
}
