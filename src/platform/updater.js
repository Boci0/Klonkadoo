// ============================================================
// In-app updater for the GitHub builds.
// - Windows (Tauri): the updater plugin reads latest.json from the
//   newest GitHub release, verifies its signature, installs, restarts.
// - Android: asks the GitHub API for the newest release and hands
//   its APK to the native ApkInstaller plugin.
// - Web: always current, nothing to do.
// checkForUpdate() resolves to null when there is nothing to offer
// (up to date, offline, rate-limited...): updates never block play.
// ============================================================

import { Capacitor, registerPlugin } from '@capacitor/core';
import { CONFIG } from '../config.js';
import pkg from '../../package.json';
import { isDesktop } from './desktop.js';

const ApkInstaller = registerPlugin('ApkInstaller');
const SKIP_KEY = 'slingshot-update-skip';

export const canSelfUpdate = isDesktop || Capacitor.isNativePlatform();

/** Compare dotted versions: >0 when a is newer than b. */
function compareVersions(a, b) {
  const pa = a.split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  const pb = b.split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
}

/**
 * @returns {Promise<null | {
 *   version: string,
 *   notes: string,
 *   install: (onProgress: (p: number) => void) => Promise<void>,
 * }>}
 */
export async function checkForUpdate() {
  try {
    if (isDesktop) return await checkDesktop();
    if (Capacitor.isNativePlatform()) return await checkAndroid();
  } catch (e) {
    console.warn('Update check failed', e);
  }
  return null;
}

async function checkDesktop() {
  const { check } = await import('@tauri-apps/plugin-updater');
  const update = await check();
  if (!update) return null;
  return {
    version: update.version,
    notes: update.body || '',
    install: async (onProgress) => {
      let total = 0;
      let done = 0;
      await update.downloadAndInstall((ev) => {
        if (ev.event === 'Started') total = ev.data.contentLength || 0;
        if (ev.event === 'Progress') {
          done += ev.data.chunkLength;
          if (total) onProgress(done / total);
        }
      });
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    },
  };
}

async function checkAndroid() {
  const res = await fetch(`https://api.github.com/repos/${CONFIG.update.repo}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) return null;
  const release = await res.json();
  const version = String(release.tag_name || '').replace(/^v/, '');
  const apk = (release.assets || []).find((a) => a.name.endsWith('.apk'));
  if (!apk || compareVersions(version, pkg.version) <= 0) return null;
  return {
    version,
    notes: release.body || '',
    install: async (onProgress) => {
      const { allowed } = await ApkInstaller.canInstall();
      if (!allowed) {
        await ApkInstaller.openInstallSettings();
        const err = new Error('Allow installs from KLONKADOO, then tap UPDATE again.');
        err.needsPermission = true;
        throw err;
      }
      const sub = await ApkInstaller.addListener('progress', (ev) => {
        if (ev.progress >= 0) onProgress(ev.progress);
      });
      try {
        await ApkInstaller.install({ url: apk.browser_download_url });
      } finally {
        sub.remove();
      }
    },
  };
}

/** "Later" on the launch prompt hides that one version until a newer one ships. */
export function isSkipped(version) {
  try {
    return localStorage.getItem(SKIP_KEY) === version;
  } catch (_) {
    return false;
  }
}

export function skipVersion(version) {
  try {
    localStorage.setItem(SKIP_KEY, version);
  } catch (_) {}
}
