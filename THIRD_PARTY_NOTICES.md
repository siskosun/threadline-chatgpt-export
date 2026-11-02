# Third-party notices

## ChatGPT Markdown Export

Repository: https://github.com/thekester/chatgpt-export
Pinned commit: 13568bf75688de74a5af563b20d5ccd28f4ad532 (v0.6.59).
License: MIT; the original license is preserved verbatim in LICENSE.

The upstream read-only exporter, renderer, icons, and libraries remain in the source tree. ThreadLine's new archive adapter follows the upstream read-only endpoint families. The streaming ZIP/ZIP64 header layout in src/tl-archive.js is adapted from upstream src/zip.js. Destructive conversation/project actions have been removed from the active fork. Upstream releases are not automatically tracked.

## MoveChat

Repository: https://github.com/VC067/MoveChat
Reference commit: c4fdb698c09c8be4fbe572ab8a7420bd1e0deb0f (v1.2.1).

The new-chat interaction design (File/DataTransfer, context transcript and manual review) was informed by MoveChat. ThreadLine uses its own source/document-bound adapter and does not import autoSend or empty-file fallbacks.

MIT License

Copyright (c) 2026 VC067

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Other references

pionxzh/chatgpt-exporter was reviewed for asset-pointer compatibility; no additional library from it is bundled. SHA-256 and CRC implementations are independently implemented and tested against standard vectors and Python/Node reference implementations. Runtime dependencies require no external script downloads.
