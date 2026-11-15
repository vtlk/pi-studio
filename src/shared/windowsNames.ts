/** Reject Win32 device aliases, alternate streams and names normalized by the filesystem. */
export function windowsFileName(name: string) {
  return (
    !!name &&
    !/[<>:"/\\|?*\p{Cc}]/u.test(name) &&
    !/[. ]$/.test(name) &&
    !/^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(name)
  );
}
