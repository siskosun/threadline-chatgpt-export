# A0 upstream base and security audit

Date: 2026-11-01

## Provenance

- Upstream: `thekester/chatgpt-export`
- Upstream release: `v0.6.59`
- Pinned upstream commit: `13568bf75688de74a5af563b20d5ccd28f4ad532`
- Fork: `siskosun/threadline-chatgpt-export`
- License at pinned upstream commit: MIT (`LICENSE`).

The cloud branch `threadline/a0-base-cloud` starts from the exact pinned commit. No local source changes are part of this branch.

## A0 changes

1. Rename the product and package identity to ThreadLine Archive, version `0.7.0`.
2. Remove conversation deletion and project deletion from content scripts, picker UI, popup UI, action dispatch, and export completion.
3. Retain a non-destructive review list for successfully exported conversations.
4. Remove `<all_urls>` from optional host permissions.
5. Restrict external media download permissions to HTTPS OpenAI media hosts:
   - `oaiusercontent.com` and its subdomains
   - `oaistatic.com` and its subdomains
   - `images.openai.com`
6. Validate the URL and extension sender again in the background fetch handler. Cross-host redirects are rejected.

## Behavior and limitations

- The current ChatGPT export flow remains the upstream capture implementation.
- Third-party web images and other non-allowlisted media remain remote links; they are not fetched with broad website permissions.
- This A0 commit does not yet implement IndexedDB archival, live sandbox-file caching, transcript compilation, or MoveChat-style handoff.
- No source conversation or project is modified by the extension.
- No local HTTP server, resident process, or cloud backend is introduced.

## Verification

The `verify` GitHub Actions workflow builds the Chrome/Chromium/Edge/Firefox packages, runs Node security/regression tests, and checks the Edge store ZIP manifest. Real Edge/ChatGPT end-to-end validation remains a separate acceptance stage.