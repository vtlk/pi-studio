# Supplemental license provenance

The native build collects full notices from installed packages into
`out/renderer/THIRD_PARTY_NOTICES.txt`. The pinned package exception is explicit
in `scripts/bundled-notices.ts`; a missing full notice fails the build.

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

## Native Cua / UBRN source availability (2026-11-17)

The source references in [Cua-SOURCES.md](Cua-SOURCES.md) cover the matching
macOS and Windows native packages. The published alpha.86 ZIPs each contain
167 SDK/JavaScript runtime files that match the SHA-512-verified npm archives
of `@trycua/cua-driver@0.49.11`, `@ubjs/core@0.31.0-3` and
`@ubjs/node@0.31.0-3` byte for byte.

The linked `uniffi-bindgen-react-native@0.31.0-3` archive includes 12 N-API Rust
source files and its MPL source notice. The pinned Cua commit's exact build
transform and MPL trampoline-cache source are publicly retrievable. Both ZIPs
retain the full MPL text, Cua MIT text, runtime notice and corresponding-source
references. This checks the shipped notices and available source described by
[MPL section 3.2](https://www.mozilla.org/en-US/MPL/2.0/);
it does not reproduce the native binaries.

Evidence: [alpha86-cua-source-availability-proof.json](../artifacts/alpha86-cua-source-availability-proof.json).

## Local Whisper Turbo (2026-11-19)

The browser voice worker bundles Transformers.js 4.3.2 and ONNX Runtime Web;
model weights are downloaded only after explicit first microphone use, pinned
to a revision, length and SHA-256 in the model manifest. Whisper's MIT notice
is preserved from OpenAI's v20250625 source.

The ONNX Runtime npm packages omit the complete upstream license/notices.
The unmodified supplemental MIT license and ThirdPartyNotices were extracted
from Microsoft's official ONNX Runtime 1.32.0 PyPI wheel, whose archive hash,
entry names, URLs and full-text hashes are recorded in `voice-sources.json`.
This documents the actual notice source; it does not assert that the wheel
is the source of the shipped Web runtime. The collector pins these texts
and the package verifier checks their complete byte preservation.
