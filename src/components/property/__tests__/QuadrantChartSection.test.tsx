// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { QuadrantChartSection } from "../QuadrantChartSection";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mockFetchOnce(response: { ok: boolean; status?: number; json?: () => Promise<unknown> }) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: response.ok,
      status: response.status ?? (response.ok ? 200 : 500),
      json: response.json ?? (async () => ({})),
    }),
  );
}

describe("QuadrantChartSection", () => {
  it("renders QuadrantChart with the segments returned by a successful fetch", async () => {
    mockFetchOnce({
      ok: true,
      json: async () => ({
        segments: [
          { name: "3 bedroom homes", low: 640_000, avg: 715_000, median: 700_000, sufficientData: true },
          { name: "4 bedroom homes", low: 760_000, avg: 850_000, median: 835_000, sufficientData: true },
          { name: "5+ bedroom homes", low: 950_000, avg: 1_100_000, median: 1_050_000, sufficientData: true },
          { name: "Units / townhouses", low: 520_000, avg: 605_000, median: 590_000, sufficientData: true },
        ],
        dataDate: "2026-06-15",
      }),
    });

    render(<QuadrantChartSection suburb="Berwick" targetAddress="9 Gloucester Ave, Berwick VIC 3806" />);

    await waitFor(() => expect(screen.getAllByText("3 bedroom homes").length).toBeGreaterThan(0));
  });

  it("shows a loading skeleton while the fetch is in flight", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    render(<QuadrantChartSection suburb="Berwick" targetAddress="9 Gloucester Ave, Berwick VIC 3806" />);
    expect(screen.queryByText("3 bedroom homes")).not.toBeInTheDocument();
  });

  it("renders nothing when the fetch fails (network error)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const { container } = render(
      <QuadrantChartSection suburb="Berwick" targetAddress="9 Gloucester Ave, Berwick VIC 3806" />,
    );
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("renders nothing when the fetch returns a non-2xx status", async () => {
    mockFetchOnce({ ok: false, status: 500 });
    const { container } = render(
      <QuadrantChartSection suburb="Berwick" targetAddress="9 Gloucester Ave, Berwick VIC 3806" />,
    );
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("passes targetAddress/suburb/dataDate through to QuadrantChart", async () => {
    mockFetchOnce({
      ok: true,
      json: async () => ({
        segments: [
          { name: "3 bedroom homes", low: 640_000, avg: 715_000, median: 700_000, sufficientData: true },
          { name: "4 bedroom homes", low: 760_000, avg: 850_000, median: 835_000, sufficientData: true },
          { name: "5+ bedroom homes", low: 950_000, avg: 1_100_000, median: 1_050_000, sufficientData: true },
          { name: "Units / townhouses", low: 520_000, avg: 605_000, median: 590_000, sufficientData: true },
        ],
        dataDate: "2026-06-15",
      }),
    });

    render(<QuadrantChartSection suburb="Officer" targetAddress="42 New Rd, Officer VIC 3809" />);

    await waitFor(() =>
      expect(screen.getByText("42 New Rd, Officer VIC 3809")).toBeInTheDocument(),
    );
    expect(screen.getByText("Officer · Data as at 15 June 2026")).toBeInTheDocument();
  });
});
