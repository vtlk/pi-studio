# Browser components

The Pi Studio adapter uses agent-browser 0.43.0 from Vercel Labs, Apache-2.0.
Source: https://github.com/vercel-labs/agent-browser/tree/v0.43.0
License: agent-browser-LICENSE.txt in this directory.
Official macOS native artifacts are downloaded explicitly from the npm registry,
with pinned SHA-512 checksums. No global npm installation or package scripts run.

The isolated browser is Chrome for Testing headless shell 157.0.8103.78.
Source: https://googlechromelabs.github.io/chrome-for-testing/
Official macOS archives are downloaded explicitly from Google's public bucket,
with pinned SHA-256 checksums. Their complete LICENSE.headless_shell and other
distribution files remain in the installed runtime directory. Pi Studio does not
remove or replace the upstream Chromium third-party notices.

Visible mode optionally installs the full official Chrome for Testing of the same
version on macOS, in a separate private runtime directory (not /Applications).
Its app bundle, frameworks, helper executables and upstream licenses are retained
unmodified. Mac ARM64 and x64 archives have independently verified pinned SHA-256.
The live yellow page cursor uses Lucide MousePointer2 geometry from lucide-react
0.577.0, ISC (see the bundled Lucide notice). Upstream recording uses --cursor;
its baked-in recorded pointer keeps upstream styling, separate from the live yellow overlay.

Neither component is a second LLM or a paid hosted browser service. Installation
does not connect to a personal browser, profile or remote debugging port.
