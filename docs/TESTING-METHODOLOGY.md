# Testing Methodology

Tests assert observable profile behavior: generated file bytes, guard decisions,
installer results, OpenCode configuration, and browser process behavior. They do
not infer success from agent prose.

Focused tests run before a broader suite. A passing publisher or guard unit test
does not prove installation. A passing installer test does not prove live browser
access. Keep those evidence classes separate in reports.

Use temporary configuration roots for installer tests. Preserve modified files in
fixtures so retirement tests prove non-destructive behavior. Browser tests must
use the managed Playwright runtime and must not expose saved authentication state.
