# Supplemental license provenance

The native build collects full notices from installed packages into
`out/renderer/THIRD_PARTY_NOTICES.txt`. Two pinned package exceptions are explicit
in `scripts/bundled-notices.ts`; a missing full notice fails the build.

- `@remotion/media@4.0.543` omits LICENSE.md in its npm tarball. The repository-wide
  [v4.0.543 LICENSE.md](https://github.com/remotion-dev/remotion/blob/v4.0.543/LICENSE.md)
  is byte-identical to the installed `@remotion/player@4.0.543/LICENSE.md` used by
  the collector (SHA-256 `53e92b6560f26f9d913a8ac97e4861e013c99ee9164fa0b11c25d8a02672fc09`).
- `react-remove-scroll-bar@2.3.8` declares MIT but omits its license file.
  `React-remove-scroll-bar-LICENSE.txt` is the unmodified author/repository
  [LICENSE at 8ca9ba5](https://github.com/theKashey/react-remove-scroll-bar/blob/8ca9ba5ea52de03308fe8ced94f7b159a44d28ff/LICENSE).
  This is supplemental attribution, not verification of the exact npm release
  source: registry `gitHead` `b3b1287aad81def2e2ae707274b74531b61ddbaf` returned
  GitHub 404 on 2026-11-16; the available upstream commit identifies itself as
  2.3.7. Keep this provenance limitation in the final distribution-rights audit.

macOS packaging also copies Electron's root LICENSE and LICENSES.chromium.html
from the installed Electron distribution. Windows retains them from the pinned
official Electron ZIP. Other existing dependency notices remain in the packaged
`licenses/` and dependency directories.

## Byte-verified notice manifests

New builds emit schema 2 in `third-party-packages.json`, indexing the exact UTF-8
byte span, SHA-256, source filenames and package/version owners of every complete
notice in `THIRD_PARTY_NOTICES.txt`. Both the collector and release-package
verifier reject missing/changed text or inconsistent bindings. This verifies
notice preservation, not permission or eligibility to redistribute dependencies.
Previously published immutable packages keep their original schema 1 manifests;
this does not change the runtime updater or replace historical release evidence.

## Additional registry-content check (2026-11-16)

The official npm tarballs for `react-remove-scroll-bar` 2.3.7 and 2.3.8 were
fetched read-only and verified against registry SHA-512 integrity; the current
2.3.8 lockfile agrees. All 25 runtime/type files under `dist/` and `constants/`
are byte-identical across those releases. All 27 installed 2.3.8 files match its
published tarball. Both versions declare MIT. Both advertised `gitHead` LICENSE
URLs still return 404, so this narrows the content question without claiming an
exact release-source license match. No downloaded code ran or archive was kept.
Evidence: `artifacts/scrollbar-license-provenance-proof.json`.
