"use client";

import { motion } from "framer-motion";
import { Building2, Database, Activity } from "lucide-react";
import { AddressSearch } from "@/components/search/AddressSearch";

const prefersReducedMotion =
  typeof window !== "undefined"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;

const fadeUp = prefersReducedMotion
  ? {}
  : {
      initial: { opacity: 0, y: 20 },
      animate: { opacity: 1, y: 0 },
      transition: { duration: 0.4, ease: "easeOut" },
    };

function fadeUpDelay(delay: number) {
  return prefersReducedMotion
    ? {}
    : {
        initial: { opacity: 0, y: 20 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.4, ease: "easeOut", delay },
      };
}

const stats = [
  { icon: Building2, label: "2M+ Properties", key: "properties" },
  { icon: Database, label: "15+ Data Sources", key: "sources" },
  { icon: Activity, label: "Real-time Data", key: "realtime" },
];

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col">
      {/* Nav */}
      <header className="flex items-center justify-between px-6 py-4 lg:px-12">
        <div className="flex items-center gap-2">
          <Building2 className="h-7 w-7 text-brand-600" />
          <span className="text-xl font-bold text-brand-900">PropertyIQ</span>
        </div>
      </header>

      {/* Hero */}
      <section className="flex flex-1 flex-col items-center justify-center px-6 py-24 text-center lg:py-32">
        <motion.h1
          {...fadeUp}
          className="max-w-3xl text-4xl font-extrabold tracking-tight text-brand-900 sm:text-5xl lg:text-6xl"
        >
          Every detail. Every property.{" "}
          <span className="text-brand-600">One search.</span>
        </motion.h1>

        <motion.p
          {...fadeUpDelay(0.1)}
          className="mt-6 max-w-xl text-lg text-gray-600"
        >
          Comprehensive property data aggregated from 15+ sources for
          Australian real estate professionals.
        </motion.p>

        <motion.div {...fadeUpDelay(0.2)} className="mt-10 w-full max-w-2xl">
          <AddressSearch size="lg" />
        </motion.div>

        {/* Stats bar */}
        <motion.div
          {...fadeUpDelay(0.35)}
          className="mt-16 flex flex-wrap items-center justify-center gap-8 sm:gap-12"
        >
          {stats.map(({ icon: Icon, label, key }) => (
            <div key={key} className="flex items-center gap-2 text-gray-500">
              <Icon className="h-5 w-5 text-brand-500" aria-hidden="true" />
              <span className="text-sm font-medium">{label}</span>
            </div>
          ))}
        </motion.div>
      </section>
    </main>
  );
}
