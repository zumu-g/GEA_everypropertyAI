// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { rentalListingPrice, OnMarketRentalsNearby } from "../OnMarketRentalsNearby";

describe("rentalListingPrice", () => {
  it("prefers the feed display string", () => {
    expect(rentalListingPrice({ displayPrice: "$550 per week", weeklyRent: 999 })).toBe(
      "$550 per week"
    );
  });

  it("falls back to a formatted weekly rent", () => {
    expect(rentalListingPrice({ displayPrice: null, weeklyRent: 550 })).toBe("$550/wk");
  });

  it("returns null when no price data exists", () => {
    expect(rentalListingPrice({ displayPrice: null, weeklyRent: null })).toBeNull();
  });
});

describe("OnMarketRentalsNearby", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mockFetch(results: unknown[]) {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ results }),
      })
    );
  }

  it("renders the heading and cards on a successful fetch", async () => {
    mockFetch([
      {
        rawAddress: "1 Test St, Cranbourne",
        suburb: "Cranbourne",
        displayPrice: "$550 per week",
        weeklyRent: 550,
        bedrooms: 3,
        bathrooms: 2,
        carSpaces: 1,
        landAreaSqm: 500,
        listingUrl: "https://example.com/1-test-st",
        imageUrl: null,
      },
      {
        rawAddress: "2 Test St, Cranbourne",
        suburb: "Cranbourne",
        displayPrice: null,
        weeklyRent: 600,
        bedrooms: 2,
        bathrooms: 1,
        carSpaces: null,
        landAreaSqm: null,
        listingUrl: null,
        imageUrl: null,
      },
    ]);

    render(<OnMarketRentalsNearby lat={-38.1} lng={145.3} />);

    expect(await screen.findByText("On the Market Rentals")).toBeInTheDocument();
    expect(screen.getByText("1 Test St, Cranbourne")).toBeInTheDocument();
    expect(screen.getByText("2 Test St, Cranbourne")).toBeInTheDocument();

    // Price fallback formats
    expect(screen.getByText("$550 per week")).toBeInTheDocument();
    expect(screen.getByText("$600/wk")).toBeInTheDocument();

    // Card with listingUrl renders as an external link
    const link = screen.getByText("1 Test St, Cranbourne").closest("a");
    expect(link).toHaveAttribute("href", "https://example.com/1-test-st");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("excludes the subject property address case-insensitively", async () => {
    mockFetch([
      {
        rawAddress: "1 SUBJECT St, Cranbourne",
        suburb: "Cranbourne",
        displayPrice: "$500/wk",
        weeklyRent: 500,
        bedrooms: null,
        bathrooms: null,
        carSpaces: null,
        landAreaSqm: null,
        listingUrl: null,
        imageUrl: null,
      },
    ]);

    const { container } = render(
      <OnMarketRentalsNearby lat={-38.1} lng={145.3} excludeAddress="1 subject st, cranbourne" />
    );

    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("renders nothing when results are empty", async () => {
    mockFetch([]);
    const { container } = render(<OnMarketRentalsNearby lat={-38.1} lng={145.3} />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("renders nothing on fetch error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));
    const { container } = render(<OnMarketRentalsNearby lat={-38.1} lng={145.3} />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});
