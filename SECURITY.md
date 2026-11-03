# Security and privacy

Quota Watch is a local-only Chrome extension. It does not require an OpenAI API key, collect analytics, send extension data to a project server, or persist ChatGPT conversation content.

## Data handling

- Host access is restricted to `https://chatgpt.com/*`.
- The content script reads only supported Usage surfaces and explicitly labelled usage widgets.
- Normalized quota labels, percentages, and timestamps live in `chrome.storage.session` and disappear when Chrome restarts.
- Preferences live in `chrome.storage.local`; `chrome.storage.sync` is not used.
- Notification permission is optional and requested only when the user enables alerts.
- Automatic background refresh is enabled by default and can be paused persistently.
- Reloads are allowed only for an exact, dedicated Usage URL. If that tab closes or navigates elsewhere, the watchdog adopts or creates another exact Usage tab; it never reloads the off-Usage page or a conversation.

## Repository privacy review

The public-source review completed on 2 November 2026 covered every tracked text file and package manifest. It found no API keys, authentication tokens, private keys, passwords, personal email addresses, phone numbers, local home/workspace paths, private databases, or user datasets. Email-like values under `tests/` use reserved fictional domains and exist only to verify that personal-looking values are rejected.

Runtime files contain no remote executable code, network-fetch implementation, analytics SDK, or third-party dependency. Development dependencies are used only for automated tests. `npm audit --omit=dev` reported zero vulnerabilities at publication.

The repository ignores environment files, key/certificate formats, credential exports, build caches, dependency folders, test reports, and packaged ZIP files. GitHub ownership and commit attribution remain visible through GitHub itself.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting feature if it is enabled for the repository. Avoid filing a public issue containing credentials, cookies, account screenshots, or other sensitive information.

This project is independent and is not affiliated with or endorsed by OpenAI or Google.

## Synthetic browser CI (3 November 2026)

Browser tests use a disposable profile and a local HTTPS fixture transport started before Chromium. The proxy connects only to its own numeric loopback address, serves two exact fixture paths, and denies other hosts, ports and routes. The test certificate is generated at runtime and deleted with the temporary profile; no certificate or private key is committed or uploaded. No personal browser profile, cookies, credentials or private conversations are accessed. The extension's runtime permissions and dependencies are unchanged.
