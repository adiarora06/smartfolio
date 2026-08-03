# SmartFolio Mobile Overview Design QA

## Evidence

- Source visual truth: `/Users/adiarora/.codex/generated_images/019f35b4-9937-7c12-8dfd-dcaa35c29c7b/exec-c4ae4054-6de1-48b7-8f31-ff1cf2aa7887.png`
- Browser implementation: `/tmp/smartfolio-audit/13-browser-overview-final.png`
- Simulator implementation: `/tmp/smartfolio-audit/12-unique-overview-final-simulator.png`
- Final normalized comparison: `/tmp/smartfolio-audit/14-design-comparison-final.png`
- State: demo portfolio, Growth profile, 1Y modeled horizon selected.
- Browser viewport: 393 x 852 CSS px at device scale factor 1.
- Source pixels: 853 x 1844, normalized to 393 x 852 with a centered cover crop.
- Browser implementation pixels: 393 x 852.
- Simulator pixels: 1206 x 2622, including native iOS status bar, toolbar, and tab bar.

## Full-View Comparison

The implementation preserves the selected hierarchy: compact brand toolbar, portfolio value and return, personalized Folio Path corridor, Folio Fit, one Smart Move, one primary plan action, one concentration alert, and a five-item native tab bar. The final side-by-side comparison shows matching section order, surface treatment, teal/ink palette, light borders, restrained radius, and first-viewport density.

## Focused Comparison

A separate crop was not required because the normalized 810 x 852 side-by-side keeps the chart labels, fit status, Smart Move copy, primary action, icons, and tab labels legible. The Simulator capture separately verifies native safe areas and tab-bar framing.

## Required Fidelity Surfaces

- Typography: system/SF Pro stack, weight hierarchy, line height, and numeric emphasis match the iOS target. No clipped or negatively tracked text.
- Spacing and layout: 16px phone gutters, compact grouped sections, 8px maximum card radius, and visible primary action match the source rhythm.
- Colors and tokens: SmartFolio teal, semantic gain green, warning amber, cool-gray separators, and white surfaces match the selected direction. No decorative gradients were introduced.
- Image and icon fidelity: the design contains no raster imagery. Existing Ionicons are used for standard controls; SVG is limited to live deterministic data visualizations.
- Copy and content: modeled-return wording replaces historical-performance wording because SmartFolio currently has assumptions, not portfolio history. Folio Fit and the 10% bond move come from deterministic portfolio calculations.

## Comparison History

1. Initial implementation: `/tmp/smartfolio-audit/07-unique-overview-v1.png`
   - P1: Capacitor and Ionic both reserved the top safe area, creating an oversized blank toolbar region.
   - P2: the chart, health block, and recommendation pushed the primary action below the first viewport.
   - Fixes: changed the iOS WebView content inset to `never`, then rebuilt and recaptured in Simulator.

2. Second implementation: `/tmp/smartfolio-audit/08-unique-overview-v2.png` and `/tmp/smartfolio-audit/10-browser-overview-final.png`
   - P2: normalized comparison still showed an oversized chart/health block and a wrapping international-equity recommendation.
   - Fixes: reduced chart and fit proportions, tightened vertical rhythm, prioritized a material bond gap deterministically, and renamed the first tab Home.

3. Final implementation: `/tmp/smartfolio-audit/13-browser-overview-final.png`
   - Earlier P1/P2 findings are resolved in `/tmp/smartfolio-audit/14-design-comparison-final.png`.
   - Projection horizons update the accessible modeled-return label.
   - Review my plan navigates to Portfolio.
   - Smart Move navigates to Advisor.
   - Browser console warnings/errors: none.

## Findings

No actionable P0, P1, or P2 differences remain.

Intentional deviations:

- The toolbar title is centered to use native iOS navigation behavior.
- The UI says expected/modeled return rather than presenting assumed returns as historical results.
- Folio Fit displays 72 because it is calculated from the current allocation and concentration findings rather than fixed to the mock's 78.

## Follow-Up Polish

- P3: add real portfolio-history ingestion before offering historical period selectors such as 1D and 1W.
- P3: add VoiceOver testing on a physical device before App Store submission.

final result: passed
