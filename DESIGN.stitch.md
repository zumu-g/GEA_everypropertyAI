# Design System: everypropertyAI (Google Stitch prompt contract)

> Stitch-optimised companion to the authoritative `DESIGN.md`. Use this when
> prompting Google Stitch to generate new everypropertyAI screens so output matches
> the shipped app. Tokens here mirror `DESIGN.md`; phrasing is semantic for Stitch.
>
> **Calibration for a property *data product*:** Density **6** (data-balanced,
> information-rich but not cramped), Variance **4** (structured and predictable —
> data demands legibility over artiness), Motion **3** (restrained; trust and calm,
> never cinematic). Quiet authority, the register of PropTrack / CoreLogic / Stripe.

## 1. Visual Theme & Atmosphere

A cool, white, daylight interface for real-estate professionals checking a property
in seconds. It feels like a precise instrument — clean hairline rules, generous cool
whitespace, monospaced figures, a restrained deep steel-slate accent with a muted
eucalypt secondary. Calm, trustworthy, exact. Not a marketing brochure and not
a neon dashboard: an architect's spec sheet rendered in software. Surfaces are
delineated by 1px rules and negative space, not drop shadows. Every number reads as
verified fact.

## 2. Color Palette & Roles

- **Cool Canvas** (#FBFBFC) — primary page background, faintly cool near-white (never pure white)
- **Pure Surface** (#FFFFFF) — card and container fill
- **Subtle Fill** (#F4F5F7) — chips, table stripes, icon wells, inactive segments
- **Hairline Rule** (#E7E9EE) — 1px borders and dividers (the primary structural device)
- **Charcoal Ink** (#16181D) — primary text and figures, cool near-black (never #000000)
- **Ink Soft** (#33363D) — strong secondary text / long-form copy
- **Muted Steel** (#6B7077) — labels, captions, metadata
- **Faint Steel** (#8A8F97) — tertiary text, eyebrow labels, fine print
- **Accent Steel** (#2E5470) — the primary accent: CTAs, active states, focus rings, links, chart series (deep steel-slate — never SaaS #3b82f6). Used sparingly (≈10% visual weight)
- **Accent Press** (#24435A) — accent hover/active depth; **Accent Fill** (#E4EBF1) — selected/hover fill
- **Eucalypt** (#5C7466) — secondary accent: secondary chart series, quiet highlights; text form #435548 on fill #E9EFEA
- **Growth** (#2F8F6B) / **Risk** (#C5544A) / **Warn** (#8A6425 on #F5EEDD) — semantic only, always paired with a symbol (+/−, ▲/▼), never decorative. Gold is retired from the product UI.

Max 2 accents, disciplined. No purple/neon. No warm/cool neutral fluctuation — neutrals are
uniformly cool and faintly tinted toward the steel hue.

## 3. Typography Rules

- **Display / Headings:** **Instrument Sans** — track-tight (≈ -0.02em), weight 500–600, hierarchy
  through weight + size contrast (≥1.25 ratio), never through massive size. `clamp()` scaling.
- **Body:** **Instrument Sans** — relaxed leading, secondary copy in Muted Steel, max **65–68ch** line length.
- **Data figures:** Instrument Sans with `tabular-nums` — every price, area, date, percentage,
  and stat. Precision comes from tabular alignment, not a mono face (mono retired 2026-07).
- **Banned:** Inter, system-default sans, ALL serif fonts (this is a data/software UI — serif is
  banned outright here — there is no hero-serif moment).

## 4. Component Stylings

* **Buttons:** Flat, no outer glow. Primary = Accent Steel fill, white label; secondary = Hairline
  outline with ink label, hover shifts text to accent; ghost = subtle fill on hover. Tactile press
  (scale 0.97). Focus ring in accent, 2px, with offset — never removed.
* **Cards:** Hairline-delineated (1px Hairline Rule on Pure Surface), `rounded-xl` (0.75rem). Shadow
  only on hover, and only when elevation communicates hierarchy. Prefer rules + whitespace over
  shadow. NEVER nest a card inside a card — flatten with dividers and spacing.
* **Data blocks:** At this density, replace stacked cards with hairline `border-top` dividers and
  monospaced stat cells (label above in Faint Steel eyebrow, value below in IBM Plex Mono).
* **Inputs:** Label above, helper/error below, accent focus ring. `rounded-lg`. No floating labels.
* **Loaders:** Skeleton shimmer matching exact layout dimensions (in Subtle Fill) — never a circular spinner.
* **Empty states:** A composed prompt that teaches how to populate (e.g. "Search an address to begin"),
  not bare "No data".
* **Charts:** Single Accent Steel series with a soft gradient; Eucalypt for a second series only; growth/decline via Growth/Risk. Axis context always visible.

## 5. Layout Principles

Grid-first, max-width-contained (content `max-w-5xl`, ~1024px, centred with `px-6`). Visual rhythm
through varied spacing — tight within a data group (8–12px), generous between distinct sections
(56–64px). Section headings get extra space above to read as more important. The generic "3 equal
cards in a row" feature block is banned — use 2-column zig-zag, asymmetric data grids, or
`repeat(auto-fit, minmax(280px, 1fr))`. No overlapping elements; every element owns its spatial zone.
Full-height sections use `min-h-[100dvh]`, never `h-screen`. The address-search home hero may be
centred (search-focused, single primary action); all content/data screens are left-aligned and structured.

## 6. Motion & Interaction

Restrained (Motion 3). Purposeful state changes only — entrances, focus, feedback. Standard entrance
is a 0.3–0.4s fade + slide-up (y:20→0), staggered 0.05–0.08s for lists so data cascades in rather than
snapping. Hover = opacity/brightness shift (150–200ms ease-in-out); press = scale 0.97. Animate
`transform` and `opacity` only — never width/height/top/left. No perpetual loops, no bounce/elastic,
no parallax, no auto-playing media. Always honour `prefers-reduced-motion`. Calm beats cinematic for a
trust product.

## 7. Anti-Patterns (Banned)

- No emojis anywhere
- No Inter or system-default fonts; no serif fonts (data UI)
- No pure black (#000000) or pure white (#FFFFFF) — always the cool-tinted tokens
- No neon / outer-glow shadows; no glassmorphism
- No SaaS blue (#3b82f6), no purple gradients, no rainbow data viz — one accent, one data colour
- No gradient text on headings
- No 3-equal-column card rows; no card-inside-card nesting
- No drop-shadow-heavy cards used decoratively — hairlines first
- No circular spinners on data — skeletons only
- No left/right colored accent stripes (>1px) on cards or callouts
- No generic placeholder names ("John Doe", "Acme") — use plausible Casey/Cardinia addresses & agents
- No fake round numbers (99.99%) — show real, specific figures
- No AI copy clichés ("Elevate", "Seamless", "Unleash", "Next-Gen")
- No filler UI ("Scroll to explore", bouncing chevrons, scroll arrows)
- No broken Unsplash links — use picsum.photos or SVG placeholders for mockups
- No bouncy/elastic motion, no perpetual animation loops, no parallax
