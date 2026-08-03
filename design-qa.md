# Design QA

## Evidence

- Source visual truth:
  - `/Users/bso/Downloads/KakaoTalk_Photo_2026-07-31-11-40-42 001.jpeg` (1층)
  - `/Users/bso/Downloads/KakaoTalk_Photo_2026-07-31-11-40-42 002.jpeg` (2층)
- Browser-rendered implementation:
  - `docs/design/implementation-haeun-1f-seat-map-jk-font.png`
  - `docs/design/implementation-haeun-2f-seat-map-font.png`
- Combined comparison evidence:
  - `docs/design/comparison-haeun-1f-jk-font.png`
  - `docs/design/comparison-haeun-2f-font.png`

## Normalization

- Implementation viewport and screenshot: 1194 × 834 CSS pixels, device scale factor 1.
- Source images: 3937 × 4725 pixels; the 1층 J·K focused source region was cropped and enlarged beside the rendered J·K region.
- State: 하은홀, 2026년 8월 15일 19:00 2회차, 좌석 현황.
- The original paper plan is portrait while the operational UI intentionally compresses row spacing into a tablet landscape map. Seat identity and aisle topology, rather than the paper's physical walking depth, are the comparison target.

## Required fidelity surfaces

- Fonts and typography: SVG seat labels render at 9.4px with -0.6px letter spacing and remain contained in both 1층 and 2층 seat buttons.
- Spacing and layout rhythm: J·K rows contain four aligned left-block seats each with no overlap; the aisle before seat 7 remains visible.
- Colors and visual tokens: existing purple, green, amber, and empty-seat states are unchanged.
- Image and asset fidelity: the reference plan is used as evidence; the interactive map remains data-driven SVG so every visible seat maps to a database seat ID.
- Copy and content: 1층 J·K rows now show `03, 04, 05, 06`; 2층 remains A–F and 188 seats.

## Findings

- No actionable P0, P1, or P2 issue remains.
- The earlier P1 data mismatch was J·K rows ending at seat 04. It is fixed by adding seats 05 and 06 to both rows in the SVG data and Supabase.
- The requested typography increase is visible on both floors without clipping or collision.

## Focused evidence

- `comparison-haeun-1f-jk-font.png` directly compares the source J·K `3~6` blocks with the rendered `J-03~J-06` and `K-03~K-06` blocks.
- `comparison-haeun-2f-font.png` verifies the larger labels across the complete 2층 map; a separate crop was unnecessary because labels are legible in the 1194 × 834 implementation capture.

## Interaction and data verification

- Hall selection → event selection → 좌석 현황: passed.
- 1층 J·K `03~06` accessible buttons present: passed.
- 1층 ↔ 2층 switching: passed.
- Browser console errors and warnings: none.
- Supabase counts: 1층 506, 2층 188.
- Supabase corrected IDs: `1F-J-003~006`, `1F-K-003~006`.

## Comparison history

- Before: J·K left blocks contained only `03~04`, leaving two missing seats per row and 502 mapped seats on 1층.
- Fix: expanded both blocks to `03~06`, inserted the four missing DB seats through a migration, and increased SVG text from 8.2px to 9.4px.
- After: combined visual evidence shows correct J·K membership and no label overlap; database verification reports exactly 506 seats on 1층.

final result: passed
