# Validation — 0.2.0 beta

Date: 2 November 2026. All data used in tests is fictional.

## Completed

`npm test` completed with **45 passed, 0 failed** after the final functional changes.

| Layer | Checks | What was checked |
| --- | ---: | --- |
| Parser / pure logic | 13 | Remaining vs used semantics; EN/ZH; invalid/conflicting percentages; supported quota labels; relative and timezone-qualified resets; stale/expired values; untrusted-field validation; safe monitor URL matching. |
| Service worker, mocked Chrome APIs | 15 | Message sender restrictions; per-document and tab isolation; safe monitor reload policy; automatic startup; close/navigation recovery; duplicate-tab avoidance; persistent pause; optional permission gating; alert deduplication; state restoration; scan round-trip deadlock regression. |
| Shipped content script, in-memory DOM | 12 | Split-span layouts; Chinese cards; chat/input/code exclusion; usage dialogs; explicitly labelled sidebar widgets; hidden cards; ambiguous bars; conflicting cards; unchanged reading timestamps; client-side countdown ticks; changed readings; isolated widget; SPA navigation. Some checks cover more than one scenario. |
| Shipped popup script, in-memory DOM | 5 | Empty state; quota cards/meters; reset display; stale/expired presentation; translation and actions; denied notification permission. |

The production scripts pass JavaScript syntax checks. The Manifest V3 package's declared scripts, popup and all icon sizes are present. Runtime code has no third-party dependencies, remote scripts, analytics, cookies access or model/API calls.

## Not verified

**Real Chrome extension integration did not run successfully.** Chrome startup was blocked by a process/socket restriction. The request to run outside that sandbox was rejected by the environment's approval policy. No real-browser success is claimed.

`tests/browser.cjs` is supplied for independent verification with Playwright's bundled Chromium on a permitted machine. It intercepts all ChatGPT page navigation with fictional fixtures, including a usage page and a conversation page. The intended checks include extension injection, toolbar badges, popup interactions, text mutations, monitor navigation guards and absence of runtime errors.

The automated DOM tests do not prove actual Chrome layout, host permissions, installation, notification delivery or current ChatGPT account compatibility. No signed-in account or live usage endpoint was inspected. Page selectors and labels may vary by rollout, locale, plan or workspace. A manual smoke test on the target account is required before treating this beta as verified for that account.

## Manual smoke test

1. Load `extension/` unpacked in Chrome and refresh ChatGPT.
2. Open the account's Usage page. Compare every displayed percentage to the corresponding extension card; compare remaining vs used semantics and reset times.
3. Confirm the automatic Usage tab appears without pressing Start. Leave it in the background and confirm a reload after the selected interval.
4. Confirm a conversation tab is not reloaded. Close or navigate the monitor tab, then confirm an exact Usage tab is restored within about one minute.
5. Confirm the popup source selector identifies the intended tab/workspace. If the layout is unsupported, expect no data rather than an inferred allowance.
6. Enable alerts if desired and check Chrome/OS notification permission. Real notification delivery remains an OS-level check.
7. Restart Chrome; preferences should survive, readings should not. Automatic refresh should adopt or recreate an exact Usage tab without manual activation.

## Design limits

- Values are observed from rendered UI, not cryptographically authenticated or independently reconciled.
- The parser rejects unlabelled percentages and conflicting duplicate windows. It does not convert message counts, credit balances or arbitrary progress bars into percentages.
- Dates without an unambiguous timezone remain text; relative reset times inherit the site's rounding.
- Static page rescans do not reset freshness. Re-rendered identical values may conservatively become stale until a page reload.
- The visible summary represents only fresh observed windows and explicitly names its source/window. Other unavailable quotas may still constrain use.
- Reloads and alarms depend on Chrome running and may be delayed while the computer sleeps.
