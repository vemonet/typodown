import fs from "node:fs";

type ReleaseAsset = {
  name: string;
  size: number;
  download_count: number;
  browser_download_url: string;
  updated_at: string;
};

type Release = {
  tag_name: string;
  name: string | null;
  draft: boolean;
  prerelease: boolean;
  published_at: string | null;
  html_url: string;
  assets: ReleaseAsset[];
};

const repo = process.env.GITHUB_REPOSITORY ?? "vemonet/typodown";
const token = process.env.GITHUB_TOKEN;
const outPath = process.env.RELEASES_DOWNLOAD_OUT ?? "RELEASES_DOWNLOAD.md";

async function ghGet<T>(url: string): Promise<T> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "typodown-release-stats",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status} ${res.statusText} for ${url}: ${await res.text()}`);
  }
  return (await res.json()) as T;
}

async function fetchReleases(): Promise<Release[]> {
  const releases: Release[] = [];
  for (let page = 1; page <= 100; page++) {
    const batch = await ghGet<Release[]>(
      `https://api.github.com/repos/${repo}/releases?per_page=100&page=${page}`,
    );
    releases.push(...batch);
    if (batch.length < 100) break;
  }
  return releases.filter((release) => !release.draft);
}

function formatSize(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function formatDate(date: string | null): string {
  return date ? date.slice(0, 10) : "-";
}

function formatCount(count: number): string {
  return count.toLocaleString("en-US");
}

const releases = await fetchReleases();
const totalDownloads = releases.reduce(
  (total, release) => total + release.assets.reduce((sum, asset) => sum + asset.download_count, 0),
  0,
);
const totalAssets = releases.reduce((total, release) => total + release.assets.length, 0);

const lines: string[] = [];
lines.push(`# Release downloads · ${repo}`);
lines.push("");
lines.push(`Generated on ${new Date().toISOString().slice(0, 10)} from the GitHub Releases API.`);
lines.push("");
lines.push("| Metric | Value |");
lines.push("| --- | --- |");
lines.push(`| Releases | ${formatCount(releases.length)} |`);
lines.push(`| Assets | ${formatCount(totalAssets)} |`);
lines.push(`| Total downloads | **${formatCount(totalDownloads)}** |`);
lines.push("");

if (releases.length > 0) {
  lines.push("## Downloads per release");
  lines.push("");
  lines.push("| Release | Published | Assets | Downloads |");
  lines.push("| --- | --- | ---: | ---: |");
  for (const release of releases) {
    const downloads = release.assets.reduce((sum, asset) => sum + asset.download_count, 0);
    const label = `[${release.tag_name}](${release.html_url})${release.prerelease ? " (pre-release)" : ""}`;
    lines.push(
      `| ${label} | ${formatDate(release.published_at)} | ${release.assets.length} | ${formatCount(downloads)} |`,
    );
  }
  lines.push("");

  const perAsset = new Map<string, number>();
  for (const release of releases) {
    for (const asset of release.assets) {
      perAsset.set(asset.name, (perAsset.get(asset.name) ?? 0) + asset.download_count);
    }
  }
  const topAssets = [...perAsset.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
  if (topAssets.length > 0) {
    lines.push("## Most downloaded assets (all releases)");
    lines.push("");
    lines.push("| Asset | Downloads |");
    lines.push("| --- | ---: |");
    for (const [name, downloads] of topAssets) {
      lines.push(`| \`${name}\` | ${formatCount(downloads)} |`);
    }
    lines.push("");
  }

  lines.push("## Details");
  lines.push("");
  for (const release of releases) {
    const downloads = release.assets.reduce((sum, asset) => sum + asset.download_count, 0);
    lines.push(`### ${release.name || release.tag_name}`);
    lines.push("");
    lines.push(
      `Tag [\`${release.tag_name}\`](${release.html_url}) · published ${formatDate(release.published_at)} · ${formatCount(downloads)} downloads`,
    );
    lines.push("");
    if (release.assets.length === 0) {
      lines.push("_No downloadable asset._");
      lines.push("");
      continue;
    }
    lines.push("| Asset | Size | Updated | Downloads |");
    lines.push("| --- | ---: | --- | ---: |");
    for (const asset of [...release.assets].sort((a, b) => b.download_count - a.download_count)) {
      lines.push(
        `| [\`${asset.name}\`](${asset.browser_download_url}) | ${formatSize(asset.size)} | ${formatDate(asset.updated_at)} | ${formatCount(asset.download_count)} |`,
      );
    }
    lines.push("");
  }
} else {
  lines.push("_No published release found._");
  lines.push("");
}

fs.writeFileSync(outPath, `${lines.join("\n")}`);
console.log(
  `Wrote ${outPath}: ${releases.length} releases, ${formatCount(totalDownloads)} downloads`,
);
