# Validation — Chromium integration follow-up

Date: 3 November 2026. All data used in tests is fictional. The extension version remains 0.2.0; this work is proposed in a pull request, not a release.

## Completed

`npm test` completed with **51 passed, 0 failed** after the final functional changes.

| Layer | Checks | What was checked |
| --- | ---: | --- |
| Parser / pure logic | 13 | Remaining vs used semantics; EN/ZH; invalid/conflicting percentages; supported quota labels; relative and timezone-qualified resets; stale/expired values; untrusted-field validation; safe monitor URL matching. |
| Service worker, mocked Chrome APIs | 18 | Message sender restrictions; per-document and tab isolation; safe monitor reload policy; automatic startup; close/navigation recovery; duplicate-tab avoidance; persistent pause; optional permission gating; alert deduplication; state restoration; scan round-trip deadlock regression. |
| Shipped content script, in-memory DOM | 15 | Split-span layouts; Chinese cards; chat/input/code exclusion; usage dialogs; explicitly labelled sidebar widgets; hidden cards; ambiguous bars; conflicting cards; unchanged reading timestamps; client-side countdown ticks; changed readings; isolated widget; SPA navigation. Some checks cover more than one scenario. |
| Shipped popup script, in-memory DOM | 5 | Empty state; quota cards/meters; reset display; stale/expired presentation; translation and actions; denied notification permission. |

The production scripts pass JavaScript syntax checks. The Manifest V3 package's declared scripts, popup and all icon sizes are present. Runtime code has no third-party dependencies, remote scripts, analytics, cookies access or model/API calls.

## Chromium integration

The `browser` CI job installs the repository-pinned Playwright 1.62.1 and its bundled Chromium with `npx --no-install playwright install --with-deps chromium`, then executes `npm run test:browser` on Ubuntu 24.04 / Node.js 22. Browser evidence is retained for 14 days as `synthetic-chromium-evidence`, including a JSON report and popup screenshots. The report records the exact browser version/revision, Node and Playwright versions, runner image, commit, run URL, scenario durations and any failure.

CI results for this change are pending. Local unit tests pass; the local browser download returned an invalid/truncated archive, so no local Chromium success is claimed.

### Privacy boundary and coverage

Every run creates a new temporary browser profile. A loopback proxy that never forwards requests is active before browser launch, covering the startup tab before Playwright interception is ready. Only exact synthetic Usage and conversation URLs are fulfilled; other page requests are aborted. No existing browser profile, account, credential, cookie store or private conversation is used. The temporary synthetic profile is reused solely to test preference persistence across browser restart, then deleted.

The harness loads the actual unpacked extension and checks its Manifest V3 worker, Chrome messaging, global/tab badge values, popup controls, one-minute periodic refresh, active-tab protection, closed/navigated monitor recovery, pause/resume, preference persistence and session-data clearing across a full browser restart. Recovery uses real Chrome alarm events with shortened test schedules; the one-minute refresh scenario waits for the extension's unmodified selected interval. The initial bootstrap page reload is test setup, not evidence of automatic refresh. The popup is loaded as an extension page; browser toolbar geometry and OS notification delivery are not tested.

### Regressions corrected

- Publish empty observations when previously valid cards disappear or become contradictory; otherwise old values remained current until stale.
- Reject three or more conflicting duplicate cards without dereferencing an already-rejected row.
- Exclude CSS-hidden descendants when a visible ancestor is parsed, and rescan on visibility-related attribute changes.
- Re-read the current tab immediately before a scheduled reload, rejecting pending navigation and unsafe URLs; the earlier snapshot could become stale during alarm setup.
- Retain an in-flight exact Usage tab during repeated initialization, avoiding duplicate startup monitors before the first navigation commits.

## Not verified

Synthetic Chromium success does not establish compatibility with a signed-in live ChatGPT account. No live usage endpoint or personal session is inspected. Page selectors and labels may vary by rollout, locale, plan or workspace. Target-account smoke tests and OS notification delivery remain separate manual checks.

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
