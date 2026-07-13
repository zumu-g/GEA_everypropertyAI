// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { QuadrantChart } from "../QuadrantChart";

/** Type into a field then blur it, mirroring the component's blur-to-save contract. */
function editAndBlur(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
}

afterEach(cleanup);

describe("QuadrantChart defaults", () => {
  it("renders four quadrants with AUD-formatted low/avg/median when no props are passed", () => {
    render(<QuadrantChart />);
    // Default segments include a 4-bedroom entry priced at $835,000 median.
    expect(screen.getAllByText("$835,000").length).toBeGreaterThan(0);
    expect(screen.getByText("3 bedroom homes")).toBeInTheDocument();
    expect(screen.getByText("Units / townhouses")).toBeInTheDocument();
    expect(screen.getByText("5+ bedroom homes")).toBeInTheDocument();
  });

  it("renders the target address and footer", () => {
    render(<QuadrantChart />);
    expect(screen.getByText("9 Gloucester Ave, Berwick VIC 3806")).toBeInTheDocument();
    expect(screen.getByText("Prepared by Grants Estate Agents")).toBeInTheDocument();
  });

  it("renders suburb and data date when provided", () => {
    // Footer also renders today's full date, so match the combined suburb/date
    // line exactly rather than a loose date substring.
    render(<QuadrantChart suburb="Officer" dataDate="Data as at June 2026" />);
    expect(screen.getByText("Officer · Data as at June 2026")).toBeInTheDocument();
  });
});

describe("QuadrantChart selection", () => {
  it("selecting a quadrant shows the badge; selecting another moves it (only one badge ever)", () => {
    render(<QuadrantChart />);
    const tiles = screen.getAllByRole("button", { name: /mark as most similar to yours/i });

    fireEvent.click(tiles[0]);
    expect(screen.getAllByText("Most similar to yours")).toHaveLength(1);
    expect(tiles[0]).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(tiles[1]);
    expect(screen.getAllByText("Most similar to yours")).toHaveLength(1);
    expect(tiles[0]).toHaveAttribute("aria-pressed", "false");
    expect(tiles[1]).toHaveAttribute("aria-pressed", "true");
  });

  it("clicking the selected quadrant again deselects it", () => {
    render(<QuadrantChart />);
    const tiles = screen.getAllByRole("button", { name: /mark as most similar to yours/i });
    fireEvent.click(tiles[0]);
    fireEvent.click(tiles[0]);
    expect(screen.queryByText("Most similar to yours")).not.toBeInTheDocument();
  });

  it("fires onChange with full state on selection", () => {
    const onChange = vi.fn();
    render(<QuadrantChart onChange={onChange} />);
    const tiles = screen.getAllByRole("button", { name: /mark as most similar to yours/i });
    fireEvent.click(tiles[0]);
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ selectedIndex: 0 }),
    );
  });
});

describe("QuadrantChart inline editing", () => {
  it("editing a price: click, type, blur updates to formatted AUD and calls onChange", () => {
    const onChange = vi.fn();
    render(<QuadrantChart onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit 4 bedroom homes median price" }));
    const input = screen.getByRole("textbox", { name: "4 bedroom homes median price" });
    editAndBlur(input, "900000");

    expect(screen.getByText("$900,000")).toBeInTheDocument();
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        segments: expect.arrayContaining([
          expect.objectContaining({ name: "4 bedroom homes", median: 900_000 }),
        ]),
      }),
    );
  });

  it("non-numeric junk on blur parses digits only, never renders $NaN", () => {
    render(<QuadrantChart />);

    fireEvent.click(screen.getByRole("button", { name: "Edit 4 bedroom homes median price" }));
    const input = screen.getByRole("textbox", { name: "4 bedroom homes median price" });
    editAndBlur(input, "abc");

    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
    // Reverts to the original value since "abc" has no digits.
    expect(screen.getByText("$835,000")).toBeInTheDocument();
  });

  it("editing the address persists on blur", () => {
    render(<QuadrantChart />);

    fireEvent.click(screen.getByRole("button", { name: "Edit target property address" }));
    const input = screen.getByRole("textbox", { name: "target property address" });
    editAndBlur(input, "42 New Rd, Officer VIC 3809");

    expect(screen.getByText("42 New Rd, Officer VIC 3809")).toBeInTheDocument();
  });

  it("editing a segment name persists on blur", () => {
    render(<QuadrantChart />);

    fireEvent.click(screen.getByRole("button", { name: "Edit 3 bedroom homes segment name" }));
    const input = screen.getByRole("textbox", { name: "3 bedroom homes segment name" });
    editAndBlur(input, "3 bed house");

    expect(screen.getByText("3 bed house")).toBeInTheDocument();
  });

  it("blurring an empty address reverts to the last valid value", () => {
    render(<QuadrantChart />);

    fireEvent.click(screen.getByRole("button", { name: "Edit target property address" }));
    const input = screen.getByRole("textbox", { name: "target property address" });
    editAndBlur(input, "");

    expect(screen.getByText("9 Gloucester Ave, Berwick VIC 3806")).toBeInTheDocument();
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
