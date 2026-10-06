import { registerPlugin } from "@capacitor/core";

type VersionInfo = { versionName: string; versionCode: number };

interface AppUpdatePlugin {
  currentVersion(): Promise<VersionInfo>;
  canInstallPackages(): Promise<{ allowed: boolean }>;
  openInstallPermission(): Promise<void>;
  downloadAndInstall(options: { url: string }): Promise<{ downloaded: boolean }>;
}

export const AppUpdate = registerPlugin<AppUpdatePlugin>("AppUpdate");

export type GithubRelease = {
  tag_name: string;
  name: string | null;
  body: string | null;
  html_url: string;
  assets: { name: string; browser_download_url: string }[];
};

export function findPosApk(release: GithubRelease | null): GithubRelease["assets"][number] | undefined {
  if (!release) return undefined;
  const named = release.assets.find((asset) => /^LONMOH-POS-.*\.apk$/i.test(asset.name));
  if (named) return named;

  // A release upload can retain a local build filename such as app-debug.apk.
  // If there is exactly one APK that is not the Print Bridge, it is the POS update.
  const candidates = release.assets.filter(
    (asset) => asset.name.toLowerCase().endsWith(".apk") && !/print[-_ ]?bridge/i.test(asset.name),
  );
  return candidates.length === 1 ? candidates[0] : undefined;
}

const RELEASE_URL = "https://api.github.com/repos/tonybox1025-NARA/thai-kitchen-buddy/releases/latest";

export async function getLatestAppRelease(): Promise<GithubRelease> {
  const response = await fetch(RELEASE_URL, { headers: { Accept: "application/vnd.github+json" } });
  if (!response.ok) throw new Error(`Could not check updates (HTTP ${response.status})`);
  return response.json() as Promise<GithubRelease>;
}

export function newerVersion(current: string, latestTag: string): boolean {
  const parse = (value: string) => value.replace(/^v/i, "").split(".").map((part) => Number(part) || 0);
  const currentParts = parse(current);
  const latestParts = parse(latestTag);
  for (let i = 0; i < Math.max(currentParts.length, latestParts.length); i += 1) {
    if ((latestParts[i] ?? 0) !== (currentParts[i] ?? 0)) return (latestParts[i] ?? 0) > (currentParts[i] ?? 0);
  }
  return false;
}
