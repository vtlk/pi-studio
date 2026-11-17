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
(Git Bash). Studio checks the standard machine and per-user Git installations,
then custom Bash locations in PATH. Windows WSL aliases are excluded; if no native
Bash is found, Studio asks you to install Git for Windows. These external
applications are not silently installed; WSL is not used.

If an agent reports “Session bridge disconnected”, reopen it from Studio while
Studio stays open. From alpha.94, a cold Terminal/SDK startup keeps its bridge
through the normal launch deadline instead of losing it after 20 seconds.
If the error specifically asks to reload the Pi Studio terminal profile, finish
work in Windows Terminal, close its windows yourself and launch the agent from
Studio again. Studio reports this profile error directly and does not close
terminal windows automatically. Other rejected bridge requests include their
HTTP status to help diagnose the failure. Native confirmation on the affected
Windows computer is still required.

Projects, canonical Pi dialogues and application settings are stored separately
from the program folder. Prefer “Check for updates…” in the application menu.
After a confirmed successful startup, the updater removes the previous program,
its downloaded ZIP and temporary installation folder. Failed or incomplete
recovery can retain the previous program and report an error. Native Windows
update/locking behavior remains unverified.

For a manual update, finish agent work, quit Studio and
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
