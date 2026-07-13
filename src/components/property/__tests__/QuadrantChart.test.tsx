// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { QuadrantChart } from "../QuadrantChart";

afterEach(cleanup);

/** Type into a field then blur it, mirroring the component's blur-to-save contract. */
function editAndBlur(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
}

// jsdom has no layout engine: the SVG radial chart (sm:block/hidden below sm) and
// the stacked-list mobile fallback (sm:hidden) both exist in the DOM simultaneously.
// Interaction tests scope to the SVG tree (the first of each duplicate) unless
// explicitly testing the fallback.
function svgTree() {
  const svg = document.querySelector("svg")!;
  return within(svg as unknown as HTMLElement);
}

describe("QuadrantChart insufficient-data segments", () => {
  const segments = [
    { name: "Units / townhouses", low: 520_000, avg: 605_000, median: 590_000 },
    { name: "3 bedroom homes", low: 640_000, avg: 715_000, median: 700_000 },
    { name: "4 bedroom homes", low: 0, avg: 0, median: 0, sufficientData: false },
    { name: "5+ bedroom homes", low: 950_000, avg: 1_100_000, median: 1_050_000 },
  ];

  it("hides price figures and shows a muted note for a segment flagged sufficientData: false", () => {
    render(<QuadrantChart segments={segments} />);
    const svg = svgTree();
    expect(svg.getAllByText("Not enough recent sales").length).toBeGreaterThan(0);
    // The flagged segment's own $0 figures must not be rendered anywhere.
    expect(svg.queryByText("$0")).not.toBeInTheDocument();
  });

  it("gives the insufficient segment's bar an accessible name that doesn't claim real prices", () => {
    render(<QuadrantChart segments={segments} />);
    const bar = svgTree().getByRole("button", { name: "4 bedroom homes: not enough recent sales data" });
    expect(bar).toBeInTheDocument();
  });

  it("a sufficient segment (sufficientData omitted or true) still renders its real prices", () => {
    render(<QuadrantChart segments={segments} />);
    const svg = svgTree();
    expect(svg.getAllByText("$700,000").length).toBeGreaterThan(0);
  });
});

describe("QuadrantChart defaults", () => {
  it("renders four segments with names, and low/avg/median formatted as AUD", () => {
    render(<QuadrantChart />);
    const svg = svgTree();
    expect(svg.getAllByText("$835,000").length).toBeGreaterThan(0);
    expect(svg.getAllByText("$700,000").length).toBeGreaterThan(0);
    expect(svg.getByText("3 bedroom homes")).toBeInTheDocument();
    expect(svg.getByText("Units / townhouses")).toBeInTheDocument();
    expect(svg.getByText("5+ bedroom homes")).toBeInTheDocument();
  });

  it("renders the target address and footer", () => {
    render(<QuadrantChart />);
    expect(screen.getByText("9 Gloucester Ave, Berwick VIC 3806")).toBeInTheDocument();
    expect(screen.getByText("Prepared by Grants Estate Agents")).toBeInTheDocument();
  });

  it("renders suburb and data date when provided", () => {
    render(<QuadrantChart suburb="Officer" dataDate="Data as at June 2026" />);
    expect(screen.getByText("Officer · Data as at June 2026")).toBeInTheDocument();
  });

  it("renders the mobile stacked-list fallback alongside the chart", () => {
    render(<QuadrantChart />);
    const fallback = screen.getByTestId("quadrant-stacked-fallback");
    expect(within(fallback).getByText("Units / townhouses")).toBeInTheDocument();
    expect(within(fallback).getByText("5+ bedroom homes")).toBeInTheDocument();
  });
});

describe("QuadrantChart accessibility", () => {
  it("each segment bar has an accessible name including its prices, not just pressed state", () => {
    render(<QuadrantChart />);
    const bar = svgTree().getByRole("button", {
      name: /4 bedroom homes: low \$760,000, average \$850,000, median \$835,000/i,
    });
    expect(bar).toBeInTheDocument();
  });
});

describe("QuadrantChart selection", () => {
  it("selecting a segment shows the badge; selecting another moves it (only one badge ever, per tree)", () => {
    render(<QuadrantChart />);
    const svg = svgTree();
    const bars = svg.getAllByRole("button", { name: /^Units \/ townhouses:|^3 bedroom homes:|^4 bedroom homes:|^5\+ bedroom homes:/ });

    fireEvent.click(bars[0]);
    expect(svg.getAllByText("Most similar to yours")).toHaveLength(1);
    expect(bars[0]).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(bars[1]);
    expect(svg.getAllByText("Most similar to yours")).toHaveLength(1);
    expect(bars[0]).toHaveAttribute("aria-pressed", "false");
    expect(bars[1]).toHaveAttribute("aria-pressed", "true");
  });

  it("clicking the selected segment again deselects it", () => {
    render(<QuadrantChart />);
    const svg = svgTree();
    const bars = svg.getAllByRole("button", { name: /^Units \/ townhouses:|^3 bedroom homes:|^4 bedroom homes:|^5\+ bedroom homes:/ });
    fireEvent.click(bars[0]);
    fireEvent.click(bars[0]);
    expect(svg.queryByText("Most similar to yours")).not.toBeInTheDocument();
  });

  it("keyboard activation (Enter/Space) on a segment bar toggles selection", () => {
    render(<QuadrantChart />);
    const svg = svgTree();
    const bars = svg.getAllByRole("button", { name: /^Units \/ townhouses:|^3 bedroom homes:|^4 bedroom homes:|^5\+ bedroom homes:/ });
    fireEvent.keyDown(bars[0], { key: "Enter" });
    expect(bars[0]).toHaveAttribute("aria-pressed", "true");
    fireEvent.keyDown(bars[0], { key: " " });
    expect(bars[0]).toHaveAttribute("aria-pressed", "false");
  });

  it("fires onChange with full state on selection", () => {
    const onChange = vi.fn();
    render(<QuadrantChart onChange={onChange} />);
    const bars = svgTree().getAllByRole("button", { name: /^Units \/ townhouses:|^3 bedroom homes:|^4 bedroom homes:|^5\+ bedroom homes:/ });
    fireEvent.click(bars[0]);
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ selectedIndex: 0 }),
    );
  });
});

describe("QuadrantChart inline editing (event bubbling regression)", () => {
  it("editing a price: click, type, blur updates to formatted AUD, calls onChange, and does not toggle selection", () => {
    const onChange = vi.fn();
    render(<QuadrantChart onChange={onChange} />);
    const svg = svgTree();
    const bar = svg.getByRole("button", { name: /^4 bedroom homes:/ });
    expect(bar).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(svg.getByRole("button", { name: "Edit 4 bedroom homes median price" }));
    const input = svg.getByRole("textbox", { name: "4 bedroom homes median price" });
    editAndBlur(input, "900000");

    expect(svg.getAllByText("$900,000").length).toBeGreaterThan(0);
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        segments: expect.arrayContaining([
          expect.objectContaining({ name: "4 bedroom homes", median: 900_000 }),
        ]),
      }),
    );
    // Regression guard (KTD1b): editing must never bubble into the parent bar's toggle.
    expect(bar).toHaveAttribute("aria-pressed", "false");
  });

  it("pressing Enter inside an open edit input commits the edit and does not toggle the parent segment's selection", () => {
    render(<QuadrantChart />);
    const svg = svgTree();
    const bar = svg.getByRole("button", { name: /^4 bedroom homes:/ });

    fireEvent.click(svg.getByRole("button", { name: "Edit 4 bedroom homes median price" }));
    const input = svg.getByRole("textbox", { name: "4 bedroom homes median price" });
    fireEvent.change(input, { target: { value: "950000" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(bar).toHaveAttribute("aria-pressed", "false");
  });

  it("clicking inside an open edit input does not toggle the parent segment's selection", () => {
    render(<QuadrantChart />);
    const svg = svgTree();
    const bar = svg.getByRole("button", { name: /^4 bedroom homes:/ });

    fireEvent.click(svg.getByRole("button", { name: "Edit 4 bedroom homes median price" }));
    const input = svg.getByRole("textbox", { name: "4 bedroom homes median price" });
    fireEvent.click(input);

    expect(bar).toHaveAttribute("aria-pressed", "false");
  });

  it("non-numeric junk on blur parses digits only, never renders $NaN", () => {
    render(<QuadrantChart />);
    const svg = svgTree();

    fireEvent.click(svg.getByRole("button", { name: "Edit 4 bedroom homes median price" }));
    const input = svg.getByRole("textbox", { name: "4 bedroom homes median price" });
    editAndBlur(input, "abc");

    expect(svg.queryByText(/NaN/)).not.toBeInTheDocument();
    expect(svg.getAllByText("$835,000").length).toBeGreaterThan(0);
  });

  it("editing the address persists on blur and fires onChange", () => {
    const onChange = vi.fn();
    render(<QuadrantChart onChange={onChange} />);

    fireEvent.click(screen.getAllByRole("button", { name: "Edit target property address" })[0]);
    const input = screen.getAllByRole("textbox", { name: "target property address" })[0];
    editAndBlur(input, "42 New Rd, Officer VIC 3809");

    expect(screen.getByText("42 New Rd, Officer VIC 3809")).toBeInTheDocument();
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ targetAddress: "42 New Rd, Officer VIC 3809" }),
    );
  });

  it("editing a segment name persists on blur, fires onChange, and does not toggle selection", () => {
    const onChange = vi.fn();
    render(<QuadrantChart onChange={onChange} />);
    const svg = svgTree();
    const bar = svg.getByRole("button", { name: /^3 bedroom homes:/ });

    fireEvent.click(svg.getByRole("button", { name: "Edit 3 bedroom homes segment name" }));
    const input = svg.getByRole("textbox", { name: "3 bedroom homes segment name" });
    editAndBlur(input, "3 bed house");

    expect(svg.getAllByText("3 bed house").length).toBeGreaterThan(0);
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        segments: expect.arrayContaining([expect.objectContaining({ name: "3 bed house" })]),
      }),
    );
    expect(bar).toHaveAttribute("aria-pressed", "false");
  });

  it("blurring an empty address reverts to the last valid value", () => {
    render(<QuadrantChart />);
    fireEvent.click(screen.getAllByRole("button", { name: "Edit target property address" })[0]);
    const input = screen.getAllByRole("textbox", { name: "target property address" })[0];
    editAndBlur(input, "");
    expect(screen.getByText("9 Gloucester Ave, Berwick VIC 3806")).toBeInTheDocument();
  });

  it("blurring an empty segment name reverts to the last valid value", () => {
    render(<QuadrantChart />);
    const svg = svgTree();
    fireEvent.click(svg.getByRole("button", { name: "Edit 3 bedroom homes segment name" }));
    const input = svg.getByRole("textbox", { name: "3 bedroom homes segment name" });
    editAndBlur(input, "   ");
    expect(svg.getAllByText("3 bedroom homes").length).toBeGreaterThan(0);
  });
});

describe("QuadrantChart copy summary", () => {
  it("writes plain text containing all four segment names and prices to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<QuadrantChart />);

    fireEvent.click(screen.getByRole("button", { name: "Copy summary" }));
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));

    const text = writeText.mock.calls[0][0] as string;
    expect(text).toContain("Units / townhouses");
    expect(text).toContain("3 bedroom homes");
    expect(text).toContain("4 bedroom homes");
    expect(text).toContain("5+ bedroom homes");
    expect(text).toContain("$835,000");
  });

  it("shows an inline error state when the clipboard write rejects", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    Object.assign(navigator, { clipboard: { writeText } });
    render(<QuadrantChart />);

    fireEvent.click(screen.getByRole("button", { name: "Copy summary" }));

    expect(await screen.findByText(/Copy failed/i)).toBeInTheDocument();
  });
});
