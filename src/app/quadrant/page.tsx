import { QuadrantChart } from "@/components/property/QuadrantChart";

export const metadata = {
  title: "Market Position Quadrant — PropertyIQ",
};

export default function QuadrantDemoPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:py-16">
      <QuadrantChart suburb="Berwick" dataDate="Data as at July 2026" />
    </main>
  );
}
