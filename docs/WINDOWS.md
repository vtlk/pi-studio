# Pi Studio for Windows x64

This is a portable preview for Windows 10/11 x64, cross-built on macOS.
Installation and runtime behavior still need testing on a real Windows computer.
The application does not have an Authenticode signature or an installer.

1. Verify the ZIP against the `.sha256` file from the same GitHub release.
2. Extract the entire `Pi Studio` folder to a permanent writable location.
3. Run `Pi Studio.exe` as your regular user, without administrator privileges.
4. Select a studio folder. A new studio has no teams, ordinary agents, projects,
   connections or example resources. The setup assistant is built in.
5. Configure a model connection, then create or import your agent team.

Pi and its private Node runtime can be installed through the first-launch screen.
Agent dialogues require Windows Terminal. Pi's Bash tool requires Git for Windows
(Git Bash). These external applications are not silently installed; WSL is not used.

Projects, canonical Pi dialogues and application settings are stored separately
from the program folder. For a manual update, finish agent work, quit Studio and
its Pi dialogues, and replace only the application files. Preserve your studio
folder and Windows user profile. Always extract the complete new ZIP.

Saved credentials use Windows DPAPI through Electron safeStorage. Encrypted keys
copied from a Mac are not portable: sign in or enter the keys again on Windows.
Do not send keys in agent chat or include them in exported teams.

The app previews ordinary text, Markdown, JSON, images, audio and video files.
Media support depends on Chromium codecs; PNG/JPEG, H.264 MP4 and PCM WAV are
practical interchange formats. External skills, MCP servers and plugins are
configured by the user and are not preinstalled.

Downloads and release notes: <https://github.com/vtlk/pi-studio/releases>.
