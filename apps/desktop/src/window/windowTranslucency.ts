// Shared by the main process and the sandboxed preload, so it stays free of
// Electron and Node imports.

// Windows 11 22H2 is the first build where Electron's backgroundMaterial works.
const MIN_WINDOWS_BACKDROP_BUILD = 22_621;

/**
 * Whether the OS can blur the desktop behind the main window: every macOS
 * Electron supports, and Windows 11 22H2+. `systemVersion` is the OS version
 * string (`process.getSystemVersion()` or `os.release()`), e.g. `10.0.22631`
 * on Windows.
 */
export function supportsWindowTranslucency(platform: string, systemVersion: string): boolean {
  if (platform === "darwin") return true;
  if (platform !== "win32") return false;
  const build = Number(systemVersion.split(".")[2]);
  return Number.isInteger(build) && build >= MIN_WINDOWS_BACKDROP_BUILD;
}
