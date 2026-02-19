import axios from "axios";
import fs from "fs-extra";

const USER = "benser22";
const TOKEN = process.env.GITHUB_TOKEN;

// ─── Language color map ────────────────────────────────────────────────────────
const LANG_COLORS = {
  TypeScript:  "#3178C6",
  JavaScript:  "#F1E05A",
  Python:      "#3572A5",
  HTML:        "#E34F26",
  CSS:         "#563D7C",
  SCSS:        "#C6538C",
  Vue:         "#41B883",
  Svelte:      "#FF3E00",
  "C#":        "#178600",
  "C++":       "#F34B7D",
  Java:        "#B07219",
  Go:          "#00ADD8",
  Rust:        "#DEA584",
  PHP:         "#777BB4",
  Ruby:        "#701516",
  Shell:       "#89E051",
  Dockerfile:  "#384D54",
  Kotlin:      "#A97BFF",
  Swift:       "#F05138",
  Dart:        "#00B4AB",
};

const DEFAULT_COLOR = "#858585";

// ─── API client ───────────────────────────────────────────────────────────────
const api = axios.create({
  baseURL: "https://api.github.com",
  headers: { Authorization: `token ${TOKEN}` },
});

// ─── Data fetching ────────────────────────────────────────────────────────────
async function getStats() {
  const { data: user } = await api.get(`/users/${USER}`);

  const { data: repos } = await api.get(
    `/users/${USER}/repos?per_page=100&type=owner`
  );

  const stars   = repos.reduce((acc, r) => acc + r.stargazers_count, 0);
  const forks   = repos.reduce((acc, r) => acc + r.forks_count, 0);
  const langs   = {};

  // Fetch languages in parallel, skip forks
  await Promise.allSettled(
    repos
      .filter((r) => !r.fork)
      .map(async (repo) => {
        const { data } = await api.get(repo.languages_url);
        for (const [lang, bytes] of Object.entries(data)) {
          langs[lang] = (langs[lang] || 0) + bytes;
        }
      })
  );

  return {
    repos:     user.public_repos,
    followers: user.followers,
    stars,
    forks,
    langs,
  };
}

// ─── SVG helpers ─────────────────────────────────────────────────────────────
const fmt = (n) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

// ─── Stats SVG ────────────────────────────────────────────────────────────────
function createStatsSVG({ repos, followers, stars, forks }) {
  const W = 495;
  const H = 195;

  const items = [
    { label: "Total Stars",  value: fmt(stars),     x: 124, labelY: 95,  valueY: 125 },
    { label: "Total Forks",  value: fmt(forks),     x: 372, labelY: 95,  valueY: 125 },
    { label: "Public Repos", value: fmt(repos),     x: 124, labelY: 153, valueY: 183 },
    { label: "Followers",    value: fmt(followers), x: 372, labelY: 153, valueY: 183 },
  ];

  const cells = items.map(({ label, value, x, labelY, valueY }) => `
  <text x="${x}" y="${labelY}" text-anchor="middle"
        font-family="'Segoe UI',Helvetica,Arial,sans-serif"
        font-size="12" fill="#7d9db5">${label}</text>
  <text x="${x}" y="${valueY}" text-anchor="middle"
        font-family="'Segoe UI',Helvetica,Arial,sans-serif"
        font-size="28" font-weight="700" fill="#4fc3f7">${value}</text>`
  ).join("");

  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${W}" height="${H}" rx="12" fill="#193549" stroke="#1d3a52" stroke-width="1.5"/>

  <!-- Title -->
  <text x="25" y="40" font-family="'Segoe UI',Helvetica,Arial,sans-serif"
        font-size="15" font-weight="700" fill="#cdd9e5">Benjamin's GitHub Stats</text>

  <!-- Dividers -->
  <line x1="25"  y1="54" x2="470" y2="54"  stroke="#1d3a52" stroke-width="1"/>
  <line x1="248" y1="64" x2="248" y2="135" stroke="#1d3a52" stroke-width="1"/>
  <line x1="25"  y1="135" x2="470" y2="135" stroke="#1d3a52" stroke-width="1"/>
  <line x1="248" y1="143" x2="248" y2="188" stroke="#1d3a52" stroke-width="1"/>

  ${cells}
</svg>`;
}

// ─── Languages SVG ────────────────────────────────────────────────────────────
function createLanguagesSVG(langs) {
  const TOP    = 6;
  const W      = 300;
  const PAD    = 20;
  const BAR_X  = PAD;
  const BAR_Y  = 58;
  const BAR_H  = 9;
  const BAR_W  = W - PAD * 2;

  const sorted = Object.entries(langs)
    .sort(([, a], [, b]) => b - a)
    .slice(0, TOP);

  if (sorted.length === 0) {
    return `<svg width="${W}" height="80" xmlns="http://www.w3.org/2000/svg">
  <rect width="${W}" height="80" rx="12" fill="#193549" stroke="#1d3a52" stroke-width="1.5"/>
  <text x="${W / 2}" y="45" text-anchor="middle" fill="#7d9db5"
        font-family="'Segoe UI',Helvetica,Arial,sans-serif" font-size="13">No language data yet</text>
</svg>`;
  }

  const total   = sorted.reduce((a, [, v]) => a + v, 0);
  const entries = sorted.map(([lang, bytes]) => ({
    lang,
    pct:   (bytes / total) * 100,
    color: LANG_COLORS[lang] ?? DEFAULT_COLOR,
  }));

  // Progress bar segments
  let cx = BAR_X;
  const segments = entries.map(({ pct, color }, i) => {
    const w  = (pct / 100) * BAR_W;
    const rx = i === 0 ? 4 : i === entries.length - 1 ? 4 : 0;
    const seg = `<rect x="${cx.toFixed(2)}" y="${BAR_Y}" width="${w.toFixed(2)}" height="${BAR_H}" fill="${color}"/>`;
    cx += w;
    return seg;
  }).join("\n  ");

  const barClipped = `
  <clipPath id="bc">
    <rect x="${BAR_X}" y="${BAR_Y}" width="${BAR_W}" height="${BAR_H}" rx="4"/>
  </clipPath>
  <g clip-path="url(#bc)">
    ${segments}
  </g>`;

  // Language list rows
  const LIST_START_Y = 90;
  const LINE_H       = 22;

  const rows = entries.map(({ lang, pct, color }, i) => {
    const y = LIST_START_Y + i * LINE_H;
    return `
  <circle cx="${PAD + 5}" cy="${y - 5}" r="5" fill="${color}"/>
  <text x="${PAD + 16}" y="${y}" font-family="'Segoe UI',Helvetica,Arial,sans-serif"
        font-size="12" fill="#cdd9e5">${lang}</text>
  <text x="${W - PAD}" y="${y}" text-anchor="end"
        font-family="'Segoe UI',Helvetica,Arial,sans-serif"
        font-size="12" fill="#7d9db5">${pct.toFixed(1)}%</text>`;
  }).join("");

  const H = LIST_START_Y + entries.length * LINE_H + 12;

  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${W}" height="${H}" rx="12" fill="#193549" stroke="#1d3a52" stroke-width="1.5"/>

  <!-- Title -->
  <text x="${PAD}" y="36" font-family="'Segoe UI',Helvetica,Arial,sans-serif"
        font-size="15" font-weight="700" fill="#cdd9e5">Most Used Languages</text>

  ${barClipped}
  ${rows}
</svg>`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  try {
    console.log("Fetching GitHub data...");
    const stats = await getStats();

    await fs.ensureDir("assets");
    await fs.writeFile("assets/stats.svg",     createStatsSVG(stats));
    await fs.writeFile("assets/languages.svg", createLanguagesSVG(stats.langs));

    console.log(`✅ SVGs generated successfully
    · Stars:     ${stats.stars}
    · Forks:     ${stats.forks}
    · Repos:     ${stats.repos}
    · Followers: ${stats.followers}
    · Languages: ${Object.keys(stats.langs).length}`);
  } catch (err) {
    console.error("❌ Error generating stats:", err.message);
    process.exit(1);
  }
})();
