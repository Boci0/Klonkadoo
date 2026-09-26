// ============================================================
// Desktop (Tauri / Windows) integration.
// - F11 toggles fullscreen.
// - External links (support page, mailto:) open in the system
//   browser / mail app instead of inside the game window.
// Tauri modules are imported lazily so the web and Android
// builds never load them.
// ============================================================

export const isDesktop = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** Open a URL outside the game (browser, mail app). */
export async function openExternal(url) {
  const { openUrl } = await import('@tauri-apps/plugin-opener');
  return openUrl(url);
}

if (isDesktop) {
  document.documentElement.classList.add('desktop');
  window.addEventListener('keydown', async (e) => {
    if (e.key !== 'F11') return;
    e.preventDefault();
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const win = getCurrentWindow();
    win.setFullscreen(!(await win.isFullscreen()));
  });
}
