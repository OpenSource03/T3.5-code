/**
 * True when running inside the Electron preload bridge, false in a regular browser.
 * The preload script sets window.desktopBridge via contextBridge before any web-app
 * code executes, so this is reliable at module load time.
 */
export const isElectron = typeof window !== "undefined" && window.desktopBridge !== undefined;

/**
 * True in a desktop app whose OS can blur the desktop behind the window
 * (macOS, Windows 11). Gates the Settings -> Appearance translucency row.
 */
export const isWindowTranslucencySupported =
  isElectron && window.desktopBridge?.getWindowTranslucencySupported?.() === true;
