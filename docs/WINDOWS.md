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
Agent dialogues run inside Studio using the Pi SDK in owned background processes;
Windows Terminal is not required for chat. The default command tool is native
PowerShell; ordinary Windows commands and the managed Node/npm/npx do not require
Git Bash. Git is checked separately for Git operations. Native Bash is optional
for Unix-dependent tasks: Studio passes its exact discovered path to Pi, including
custom/per-user/registry installs, and excludes WSL aliases. The setup assistant's
get_runtime reports the actual primary shell and correctly quoted PowerShell
command examples. Dependencies such as FFmpeg are installed only for a user's
requested task and checked by running their actual version/help command.

A cold SDK/MCP startup can take 40 seconds or longer. The chat opens immediately
with a loading spinner; repeated opening reuses an existing ready process. Hiding
the panel keeps Pi running. The yellow process indicator includes working and
waiting Studio-owned processes; a running process is not automatically stuck.
The chat header offers a separate confirmed process stop, preserving the saved
dialogue and files. A failed startup offers retry rather than creating duplicate
processes. Actual Windows startup/input/update acceptance remains separate from
cross-platform source and isolated macOS checks.

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
