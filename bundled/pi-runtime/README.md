# Pinned Pi bootstrap manifests

Pi 1.5.2 manifests originate from the official installer:

- https://pi.dev/api/installer/releases/1.5.2/package.json
- https://pi.dev/api/installer/releases/1.5.2/package-lock.json

The upstream lock omits integrity for eight workspace-origin Pi packages. Their exact published registry tarball URLs were matched against registry.npmjs.org version metadata and their SHA-512 integrities pinned here. All resolved packages must have registry HTTPS URLs and SHA-512 integrity before installation. No runtime resolution of the latest version occurs.

Node 22.22.1 archive SHA-256 values for macOS arm64/x64 come from https://nodejs.org/dist/v22.22.1/SHASUMS256.txt and are pinned in src/main/pi/runtimeConfig.ts.

The installer uses a private staged directory, npm ci --ignore-scripts and atomic publication after CLI/capability verification. This bundle contains installer metadata, not agent instructions, library standards, skills, credentials or project data.
