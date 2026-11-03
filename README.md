# Quota Watch for ChatGPT

A local Chrome extension that puts ChatGPT-reported remaining usage in your toolbar and on the page. Version **0.2.0 — beta**.

**The current source passed 53 Node checks and 17 real Chromium scenarios using synthetic pages. Signed-in live-account compatibility remains unverified.** Exact environment, results and CI evidence are recorded in [docs/VALIDATION.md](docs/VALIDATION.md). This follow-up keeps the extension at version 0.2.0 pending merge and release approval.

## Install in Chrome (macOS / Windows / Linux)

1. Unzip the downloaded package and keep the extracted folder in a permanent location.
2. Enter `chrome://extensions` in Chrome's address bar and enable **Developer mode**.
3. Click **Load unpacked** and select the **`extension`** folder inside `Quota-Watch`. This folder contains `manifest.json`. Select the folder, not the ZIP.
4. Pin **Quota Watch for ChatGPT** using Chrome's puzzle-piece Extensions menu.
5. Reload any ChatGPT tabs that were already open before installation.
6. Click the extension → **Open Usage**. Sign in normally on ChatGPT if needed. The extension never asks for your password or an API key.
7. Quota Watch automatically opens or adopts a separate Usage tab and refreshes it in the background every minute. You can choose two, five or ten minutes, or pause automatic refresh from the popup.

No build step, developer tools, paid API account or external service is needed to install the extension. This is an unpacked extension, not a Chrome Web Store listing. Do not move or delete its extracted folder while using it.

## What you get

- **Toolbar badge:** the lowest remaining percentage among fresh observed windows in that tab. A global badge can show the dedicated monitor's value when no per-tab override applies.
- **Popup:** separate quota cards, their source tab, last-observed times, progress bars, and reset times/countdowns when explicitly available.
- **ChatGPT panel:** a small, dismissible panel for readings from that same tab. It does not silently borrow another tab's readings.
- **Automatic background refresh:** enabled by default. It reloads only an exact Usage page, never a conversation. A one-minute watchdog adopts or recreates the Usage tab after Chrome restarts, after the tab closes, or after it navigates elsewhere. You can pause it persistently.
- **Optional alerts:** low remaining allowance (10%, 20% or 30%) and the arrival of a reported reset time. Notification access is requested only when you enable alerts.
- **English / 简体中文:** automatic language selection or manual switching. Light and dark appearance follow the system.

## What a reading means

The extension reads numeric percentages with explicit **remaining** or **used** labels from supported Usage screens and explicitly labelled sidebar usage widgets. It does not inspect private backend endpoints, session tokens, cookies or request bodies. It does not count prompts or infer a plan allowance.

OpenAI documents shared Work/Codex usage and directs users to the account's usage dashboard for current limits and reset times. This extension is a display of the site's exposed information, not a separate source of account entitlement. Regular Chat model limits, tools, credits or other quotas that are not rendered in a supported numeric format remain unavailable.

The shortcut currently opens `https://chatgpt.com/codex/settings/usage`. If your account redirects elsewhere, open **Settings → Usage** manually. Supported Usage dialogs can also be read. If the page does not expose a readable card, the extension shows **Not available**. It does not treat missing data as unlimited usage.

**Freshness is conservative.** A DOM scan is not a new server response. Re-reading unchanged page text does not refresh its timestamp or move a relative reset countdown forward. At the default interval, a reading becomes stale after three minutes. The monitor's next successful page reload supplies a new observation. Server caching or reporting delay can still affect the displayed numbers.

A reset countdown reaching zero means only that the previously reported reset time has arrived. The extension keeps the historical value marked expired until new data is observed; it never invents a restored 100% allowance. Relative countdowns inherit the precision of the site's displayed duration. Ambiguous reset dates without a timezone are displayed as text rather than guessed.

## Troubleshooting

| What you see | What to do |
| --- | --- |
| Not available / no reading | Reload the ChatGPT tab after installing. Open Settings → Usage. If it shows no labelled percentage, this release cannot determine the allowance. |
| A reading becomes stale | Confirm **Automatic background refresh on**, leave the Usage tab in the background, and check the account is signed in. |
| Usage tab was closed or navigated away | While automatic refresh is on, the watchdog adopts or creates an exact Usage tab within about one minute. |
| Usage is not reloading while you look at it | Deliberate: an active Usage tab is scanned but not force-reloaded. Switch to a conversation or another tab. |
| Panel differs from popup | The panel uses its own tab only. The popup has a source selector. Confirm that the source tab is in the intended account/workspace. |
| No notifications | Enable alerts and allow Chrome notifications in both Chrome and the operating system. |
| After a browser restart | Readings are cleared, but the automatic-refresh preference persists. Its Usage tab is adopted or recreated automatically. |

Chrome sleep, timer throttling, network failure, account changes and future UI changes can delay or prevent updates. This beta has not been tested against your signed-in account. It does not bypass usage limits or access hidden model allowances.

## Privacy and permissions

- Only `https://chatgpt.com/*` is in scope; no access to every website.
- `storage`: preferences in local storage, normalized readings in session storage. Nothing is synced to another device.
- `alarms`: periodic freshness checks, automatic Usage refreshes and watchdog recovery.
- `notifications`: optional, off by default.
- No API keys, analytics, remote executable code, credentials, account identifiers or chat transcripts are included in the package or saved by the extension.
- Readings are kept separately by tab/document. They contain standardized quota labels, percentages and timestamps. Closing a tab removes its readings. Restarting Chrome clears all readings.
- Removing the extension clears its Chrome-managed data. **Clear readings** clears current snapshots; an open Usage page may supply a new reading on the next scan. Pause automatic refresh and disable the extension to cease observation entirely.

Because a content script has site access, Chrome will correctly warn that it can read/change data on ChatGPT. Its implemented scope is usage cards and its own small panel. Account-level accuracy is bounded by the rendered page; this is not a tamper-proof accounting system.

## Development and validation

The `extension/` folder has no runtime dependencies. Source, tests and documentation are included in this package.

```sh
npm ci --ignore-scripts
npm test
```

There are 53 passing Node checks and 17 passing synthetic Chromium scenarios. See [docs/VALIDATION.md](docs/VALIDATION.md) for coverage, CI evidence and the live-account testing boundary.

For a real browser integration run on a machine that permits Chromium processes:

```sh
npx --no-install playwright install --with-deps chromium
npm run test:browser
```

The browser harness serves fictional ChatGPT pages from a local HTTPS fixture server and uses a fresh temporary browser profile. It does not use a personal account. Use the repository-pinned Playwright and its bundled Chromium. OpenSSL must be available on `PATH` for a temporary local test certificate; it is never packaged with the extension. The test network proxy serves only the exact synthetic pages and never forwards traffic to ChatGPT or another external service.

Files: `core.js` handles parsing/validation; `content.js` reads scoped usage DOM and renders the panel; `background.js` isolates session state and manages monitoring/alerts; `popup.*` implements the popup. The extension uses Manifest V3 and requires Chrome 120+.

## Sources checked on 2 November 2026

- [OpenAI: Work/Codex pricing and usage](https://learn.chatgpt.com/docs/pricing) — current allowances depend on the account and task; Work/Codex share usage; the usage dashboard is authoritative.
- [OpenAI: what's new](https://learn.chatgpt.com/docs/whats-new) — eligible accounts can expose remaining Work usage in the sidebar.
- [Chrome: content script manifest](https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts).
- [Chrome: service worker events and alarms](https://developer.chrome.com/docs/extensions/get-started/tutorial/service-worker-events).

Independent project; not affiliated with or endorsed by OpenAI or Google. ChatGPT and Chrome are their respective owners' trademarks.
