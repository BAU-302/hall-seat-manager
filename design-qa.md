# Design QA

## Evidence

- Source visual truth:
  - `docs/design/hall-selection.png`
  - `docs/design/session-dashboard.png`
  - `docs/design/haeun-1f-seat-map.png`
  - `docs/design/haeun-2f-seat-map.png`
- Browser-rendered implementation:
  - `docs/design/implementation-hall-selection.png`
  - `docs/design/implementation-session-dashboard.png`
  - `docs/design/implementation-haeun-1f-seat-map.png`
  - `docs/design/implementation-haeun-2f-seat-map.png`
- Side-by-side comparisons:
  - `docs/design/comparison-hall-selection.png`
  - `docs/design/comparison-session-dashboard.png`
  - `docs/design/comparison-haeun-1f-seat-map.png`
  - `docs/design/comparison-haeun-2f-seat-map.png`

## Normalization

- Viewport: 1138 × 908 CSS pixels.
- Device scale factor: 1.
- Source and implementation captures: 1138 × 908 pixels.
- State: 하은홀, 2026년 8월 15일 19:00 2회차.
- The small Next.js development indicator is development tooling outside the product UI and is absent from production builds.

## Required fidelity surfaces

- Fonts and typography: the Pretendard, Noto Sans KR, Apple SD Gothic Neo system stack, compact weights, line heights, and Korean copy hierarchy match the verified prototype.
- Spacing and layout rhythm: tablet shell, 174px navigation, content widths, cards, toolbars, seat-map frame, cross aisle, and footer proportions match at the normalized viewport.
- Colors and visual tokens: pearl background, lavender surfaces, purple primary states, green admission states, amber onsite states, and neutral borders are preserved.
- Image and asset fidelity: no source imagery was replaced. The seat maps remain data-driven SVG because every seat must stay interactive and map to a database seat ID.
- Copy and content: hall, event, round, date, time, seat status, and QR export language match the selected design.

## Findings

- No actionable P0, P1, or P2 difference remains.
- Hall selection, dashboard, and both floor maps preserve the visual hierarchy and density of the source.
- The implementation adds no invented seats or hall geometry.
- P3: the Next.js development badge appears at the lower-left edge only while running the development server. It does not affect the production build.

## Focused evidence

- The seat toolbar and selected-seat footer were verified at native 1:1 pixels; labels, active floor treatment, state legend, and `C-12` selection remain readable.
- Individual seat labels and the K–L cross aisle are visible in the full-resolution 1F comparison, so an additional crop was not needed.
- The 2F control desk, straight front boundary, broadcast studio, and outer boundary clearance are visible in the full-resolution 2F comparison.

## Interaction verification

- Hall selection → event selection → session dashboard: passed.
- Dashboard → 1F seat map → `C-12` search and selection: passed.
- 1F ↔ 2F switching: passed.
- QR generation → full-session mode → ZIP preparation enabled: passed.
- Browser console errors and warnings from the current Next.js page: none.

## Comparison history

- Initial migration retained the source CSS and data-driven seat components.
- TypeScript conversion fixed an undefined hall-transition possibility and normalized history status rows without changing visible layout.
- Post-fix browser captures show no actionable visual drift.

final result: passed
