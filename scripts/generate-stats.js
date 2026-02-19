import axios from "axios";
import fs from "fs-extra";

const USER  = "benser22";
const TOKEN = process.env.GITHUB_TOKEN;

// ─── Shared card height (keeps both SVGs aligned side by side) ────────────────
const CARD_H = 234;

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

// ─── API clients ──────────────────────────────────────────────────────────────
const rest = axios.create({
  baseURL: "https://api.github.com",
  headers: { Authorization: `token ${TOKEN}` },
});

async function graphql(query) {
  const { data } = await axios.post(
    "https://api.github.com/graphql",
    { query },
    { headers: { Authorization: `bearer ${TOKEN}` } }
  );
  if (data.errors) throw new Error(data.errors[0].message);
  return data.data;
}

// ─── Data fetching ────────────────────────────────────────────────────────────
async function getContributionsByYear(years) {
  const fragments = years.map((year) => {
    const from = `${year}-01-01T00:00:00Z`;
    const to   = `${year}-12-31T23:59:59Z`;
    return `
      y${year}: contributionsCollection(from: "${from}", to: "${to}") {
        contributionCalendar { totalContributions }
      }`;
  }).join("\n");

  const query = `{ user(login: "${USER}") { ${fragments} } }`;
  const data  = await graphql(query);

  return years.map((year) => ({
    year,
    count: data.user[`y${year}`].contributionCalendar.totalContributions,
  }));
}

async function getStats() {
  const { data: user } = await rest.get(`/users/${USER}`);
  const { data: repos } = await rest.get(`/users/${USER}/repos?per_page=100&type=owner`);

  const langs = {};
  await Promise.allSettled(
    repos
      .filter((r) => !r.fork)
      .map(async (repo) => {
        const { data } = await rest.get(repo.languages_url);
        for (const [lang, bytes] of Object.entries(data)) {
          langs[lang] = (langs[lang] || 0) + bytes;
        }
      })
  );

  const startYear   = new Date(user.created_at).getFullYear();
  const currentYear = new Date().getFullYear();
  const years       = Array.from(
    { length: currentYear - startYear + 1 },
    (_, i) => startYear + i
  );

  const contributions      = await getContributionsByYear(years);
  const totalContributions = contributions.reduce((a, b) => a + b.count, 0);

  // Always show last 4 years in the chart — total reflects full history
  const recentContributions = contributions.slice(-4);

  return { contributions: recentContributions, totalContributions, langs };
}

// ─── SVG helpers ─────────────────────────────────────────────────────────────
const fmt = (n) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

// ─── Contributions SVG ────────────────────────────────────────────────────────
function createStatsSVG({ contributions, totalContributions }) {
  const W          = 495;
  const PAD        = 25;
  const BAR_AREA   = W - PAD * 2;
  const BARS_START = 100;               // y top-limit for bars
  const BAR_MAX_H  = CARD_H - BARS_START - 36; // fills remaining space → 98px
  const years      = contributions.filter((y) => y.count > 0);
  const max        = Math.max(...years.map((y) => y.count));
  const BAR_W      = Math.min(50, Math.floor((BAR_AREA - (years.length - 1) * 10) / years.length));
  const BAR_GAP    = Math.floor((BAR_AREA - BAR_W * years.length) / Math.max(years.length - 1, 1));

  const bars = years.map(({ year, count }, i) => {
    const barH   = Math.max(4, Math.round((count / max) * BAR_MAX_H));
    const x      = PAD + i * (BAR_W + BAR_GAP);
    const barY   = BARS_START + BAR_MAX_H - barH;
    const labelY = barY - 6;
    const yearY  = BARS_START + BAR_MAX_H + 16;
    return `
  <rect x="${x}" y="${barY}" width="${BAR_W}" height="${barH}" rx="4" fill="#4fc3f7" opacity="0.85"/>
  <text x="${x + BAR_W / 2}" y="${labelY}" text-anchor="middle"
        font-family="'Segoe UI',Helvetica,Arial,sans-serif"
        font-size="11" fill="#4fc3f7">${fmt(count)}</text>
  <text x="${x + BAR_W / 2}" y="${yearY}" text-anchor="middle"
        font-family="'Segoe UI',Helvetica,Arial,sans-serif"
        font-size="11" fill="#7d9db5">${year}</text>`;
  }).join("");

  return `<svg width="${W}" height="${CARD_H}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${W}" height="${CARD_H}" rx="12" fill="#193549" stroke="#1d3a52" stroke-width="1.5"/>
  <text x="${PAD}" y="28" font-family="'Segoe UI',Helvetica,Arial,sans-serif"
        font-size="13" font-weight="700" fill="#cdd9e5">Total Contributions</text>
  <text x="${W / 2}" y="78" text-anchor="middle"
        font-family="'Segoe UI',Helvetica,Arial,sans-serif"
        font-size="38" font-weight="700" fill="#4fc3f7">${totalContributions.toLocaleString("en-US")}</text>
  <line x1="${PAD}" y1="90" x2="${W - PAD}" y2="90" stroke="#1d3a52" stroke-width="1"/>
  ${bars}
</svg>`;
}

// ─── Languages SVG ────────────────────────────────────────────────────────────
function createLanguagesSVG(langs) {
  const TOP   = 6;
  const W     = 300;
  const PAD   = 20;
  const BAR_Y = 58;
  const BAR_H = 9;
  const BAR_W = W - PAD * 2;

  const sorted = Object.entries(langs)
    .sort(([, a], [, b]) => b - a)
    .slice(0, TOP);

  if (sorted.length === 0) {
    return `<svg width="${W}" height="${CARD_H}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${W}" height="${CARD_H}" rx="12" fill="#193549" stroke="#1d3a52" stroke-width="1.5"/>
  <text x="${W / 2}" y="${CARD_H / 2}" text-anchor="middle" fill="#7d9db5"
        font-family="'Segoe UI',Helvetica,Arial,sans-serif" font-size="13">No language data yet</text>
</svg>`;
  }

  const total   = sorted.reduce((a, [, v]) => a + v, 0);
  const entries = sorted.map(([lang, bytes]) => ({
    lang,
    pct:   (bytes / total) * 100,
    color: LANG_COLORS[lang] ?? DEFAULT_COLOR,
  }));

  let cx = PAD;
  const segments = entries.map(({ pct, color }) => {
    const w   = (pct / 100) * BAR_W;
    const seg = `<rect x="${cx.toFixed(2)}" y="${BAR_Y}" width="${w.toFixed(2)}" height="${BAR_H}" fill="${color}"/>`;
    cx += w;
    return seg;
  }).join("\n  ");

  const barClipped = `
  <clipPath id="bc">
    <rect x="${PAD}" y="${BAR_Y}" width="${BAR_W}" height="${BAR_H}" rx="4"/>
  </clipPath>
  <g clip-path="url(#bc)">
    ${segments}
  </g>`;

  // Distribute rows evenly within the card
  const LIST_AREA    = CARD_H - 90 - 12; // space below the progress bar
  const LINE_H       = Math.floor(LIST_AREA / entries.length);
  const LIST_START_Y = 90 + Math.floor(LINE_H * 0.75);

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

  return `<svg width="${W}" height="${CARD_H}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${W}" height="${CARD_H}" rx="12" fill="#193549" stroke="#1d3a52" stroke-width="1.5"/>
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
    · Total contributions: ${stats.totalContributions}
    · By year: ${stats.contributions.map((y) => `${y.year}: ${y.count}`).join(", ")}
    · Languages: ${Object.keys(stats.langs).length}`);
  } catch (err) {
    console.error("❌ Error generating stats:", err.message);
    process.exit(1);
  }
})();
