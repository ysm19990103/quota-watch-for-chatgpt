# Validation — Chromium integration follow-up

Date: 3 November 2026. All data used in tests is fictional. The extension version remains 0.2.0; this work is proposed in a pull request, not a release.

## Completed

`npm test` completed with **53 passed, 0 failed** after the final functional changes.

| Layer | Checks | What was checked |
| --- | ---: | --- |
| Parser / pure logic | 13 | Remaining vs used semantics; EN/ZH; invalid/conflicting percentages; supported quota labels; relative and timezone-qualified resets; stale/expired values; untrusted-field validation; safe monitor URL matching. |
| Service worker, mocked Chrome APIs | 19 | Message sender restrictions; per-document and tab isolation; safe monitor reload policy; automatic startup; close/navigation recovery; duplicate-tab avoidance; persistent pause; optional permission gating; alert deduplication; state restoration; scan round-trip deadlock regression. |
| Shipped content script, in-memory DOM | 15 | Split-span layouts; Chinese cards; chat/input/code exclusion; usage dialogs; explicitly labelled sidebar widgets; hidden cards; ambiguous bars; conflicting cards; unchanged reading timestamps; client-side countdown ticks; changed readings; isolated widget; SPA navigation. Some checks cover more than one scenario. |
| Shipped popup script, in-memory DOM | 5 | Empty state; quota cards/meters; reset display; stale/expired presentation; translation and actions; denied notification permission. |
| Synthetic HTTPS transport | 1 | Dynamic local fixture responses; rejects unknown hosts, ports, paths, query strings, HTTP methods and plain HTTP without upstream connections. |

The production scripts pass JavaScript syntax checks. The Manifest V3 package's declared scripts, popup and all icon sizes are present. Runtime code has no third-party dependencies, remote scripts, analytics, cookies access or model/API calls.

## Chromium integration

The `browser` CI job installs the repository-pinned Playwright 1.62.1 and its bundled Chromium with `npx --no-install playwright install --with-deps chromium`, then executes `npm run test:browser` on Ubuntu 24.04 / Node.js 22. Browser evidence is retained for 14 days as `synthetic-chromium-evidence`, including a JSON report and popup screenshots. The report records the exact browser version/revision, Node and Playwright versions, runner image, commit, run URL, scenario durations and any failure.

**GitHub Actions run [41586546949](https://github.com/ysm19990103/quota-watch-for-chatgpt/actions/runs/41586546949) passed both jobs: 53 Node checks and 17 Chromium scenarios, with zero browser JavaScript errors.** The source head was `dbb5a2f9afe3d995ddcfd8ccc6ddf21dfeef8ead`; GitHub tested the PR merge checkout `c9b648eda034b920da92ccabca840616884220f4` against unchanged main `a18552553596c9201692aec847bbe2787643efda`.

| Environment | Verified value |
| --- | --- |
| Runner | GitHub-hosted Ubuntu 24.04.5, Linux x64 |
| Runtime image variable | `ubuntu24`, `20261026.354.1` |
| Kernel | `7.0.0-1017-azure` |
| Node.js / Playwright | `v22.23.4` / `1.62.1` |
| Browser | Bundled Chromium / Chrome for Testing `151.0.7922.34`, headless |
| Browser revision | `782af9cb30a53f54487e5d2e44738645a8ec457c` |
| JavaScript engine | `15.1.206.8` |
| Browser execution | 68.603 seconds, including the real one-minute periodic refresh |

The full machine-readable result is preserved in [browser-results.json](browser-results.json). [CI artifacts](https://github.com/ysm19990103/quota-watch-for-chatgpt/actions/runs/41586546949/artifacts/13208206416) also contain English and Chinese popup screenshots, available until 17 November 2026. The transport served five synthetic Usage requests and two synthetic conversation requests; it denied 54 other connections and seven unsupported requests. No requests were forwarded upstream.

The saved [Node TAP output](test-results.tap) is from local Node.js `v24.22.1`; the CI run independently passed the same 53 checks using `v22.23.4`. The local Chromium download returned an invalid/truncated archive, so browser success is claimed only for GitHub Actions.

### Privacy boundary and coverage

Every run creates a new temporary browser profile. A local HTTPS fixture server and proxy are active before browser launch, covering every extension-created tab’s first navigation. The proxy accepts only `CONNECT chatgpt.com:443` and connects exclusively to its own numeric loopback address and port. Only exact GET requests for the synthetic Usage and conversation paths are fulfilled; other hosts, ports, paths, queries and methods are denied. It has no upstream forwarding or external DNS lookup code path. OpenSSL generates a temporary self-signed certificate inside the disposable profile; only this test browser ignores certificate errors, and the certificate/private key are deleted with the profile. The fixture transport has its own Node regression test. No existing browser profile, account, credential, cookie store or private conversation is used. The temporary synthetic profile is reused solely to test preference persistence across browser restart, then deleted.

The harness loads the actual unpacked extension and checks its Manifest V3 worker, Chrome messaging, global/tab badge values, popup controls, one-minute periodic refresh, active-tab protection, closed/navigated monitor recovery, pause/resume, preference persistence and session-data clearing across a full browser restart. Recovery uses real Chrome alarm events with shortened test schedules; the one-minute refresh scenario waits for the extension's unmodified selected interval. There is no manual startup reload: the fixture server is ready before Chromium launches. Tight navigation races and pending-URL snapshots use deterministic worker unit regressions; the browser scenario verifies navigation protection after the navigation settles. The popup is loaded as an extension page; browser toolbar geometry and OS notification delivery are not tested.

### Regressions corrected

The first real-browser CI runs reproduced duplicate monitor creation at startup. A tracked loading tab is now retained through Chrome's brief URL-visibility gap. Other confirmed defects were reproduced by targeted unit/DOM tests before correction, and the resulting behavior is covered by the successful synthetic Chromium run where applicable. The old harness also required fixes for startup timing and extension-created tabs' first requests; the final transport serves those requests from launch without a bootstrap reload.

- Publish empty observations when previously valid cards disappear or become contradictory; otherwise old values remained current until stale.
- Reject three or more conflicting duplicate cards without dereferencing an already-rejected row.
- Exclude CSS-hidden descendants when a visible ancestor is parsed, and rescan on visibility-related attribute changes.
- Re-read the current tab immediately before a scheduled reload, rejecting pending navigation and unsafe URLs; the earlier snapshot could become stale during alarm setup.
- Retain an in-flight exact Usage tab during repeated initialization, including the brief loading snapshot where Chrome exposes neither URL field. This avoids duplicate startup monitors without allowing reloads of unknown destinations.

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
