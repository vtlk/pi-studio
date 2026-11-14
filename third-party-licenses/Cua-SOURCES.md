# Cua Driver 0.49.11

Pi Studio redistributes the unmodified published `@trycua/cua-driver` SDK and its matching macOS native package. Only the generated distribution copies of Mach-O binaries are signed with Pi Studio's certificate.

- Cua Driver: MIT, copyright (c) 2025 Cua AI, Inc.; see Cua-MIT.txt.
- `@ubjs/core`, `@ubjs/node` 0.31.0-3 and the copy-mode N-API runtime: Mozilla Public License 2.0; see MPL-2.0.txt and Cua-node-runtime-NOTICE.md. Copyright their respective contributors, including James Hugman.
- Exact Cua source: https://github.com/trycua/cua/tree/b3dafe7f47ab40a5d00c5023855317a2e901c062/libs/cua-driver
- Native runtime deterministic transformations: https://github.com/trycua/cua/blob/b3dafe7f47ab40a5d00c5023855317a2e901c062/libs/cua-driver/scripts/build-node-runtime.mjs
- Backported trampoline source: https://github.com/trycua/cua/blob/b3dafe7f47ab40a5d00c5023855317a2e901c062/libs/cua-driver/scripts/node-runtime-trampoline-cache.rs
- Original runtime source (includes Rust and license): https://registry.npmjs.org/uniffi-bindgen-react-native/-/uniffi-bindgen-react-native-0.31.0-3.tgz
- JavaScript runtime source: https://registry.npmjs.org/@ubjs/core/-/core-0.31.0-3.tgz and https://registry.npmjs.org/@ubjs/node/-/node-0.31.0-3.tgz

The exact Cua commit is recorded in npm's signed provenance for SDK 0.49.11: https://registry.npmjs.org/-/npm/v1/attestations/@trycua%2fcua-driver@0.49.11 . The SDK source workspace declares 0.49.11. No unrestricted mode, separate model, daemon or commercial computer-use service is bundled or required by Pi Studio's adapter.
