import { readFile } from "node:fs/promises";

const CONFIG_FILES = [".env.example", "cloudflare-env.d.ts"];
const LEGACY_CONFIG_PATTERNS = [
  /\bKIS_APP_(?:KEY|SECRET)\b/i,
  /\bKIS_(?:BASE_URL|ACCESS_TOKEN|TOKEN_URL)\b/i,
  /\bUPBIT_(?:ACCESS_KEY|SECRET_KEY|API_URL|BASE_URL)\b/i,
  /openapi\.koreainvestment\.com/i,
  /api\.upbit\.com/i,
];

const errors = [];

for (const path of CONFIG_FILES) {
  const text = await readFile(path, "utf8");
  for (const pattern of LEGACY_CONFIG_PATTERNS) {
    if (pattern.test(text)) errors.push(`${path}: legacy KIS/Upbit configuration detected (${pattern})`);
  }
}

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const directDependencies = {
  ...(packageJson.dependencies ?? {}),
  ...(packageJson.devDependencies ?? {}),
  ...(packageJson.optionalDependencies ?? {}),
};
for (const name of Object.keys(directDependencies)) {
  if (/(?:^|[-_/])(?:kis|upbit|korea-investment)(?:$|[-_/])/i.test(name)) {
    errors.push(`package.json: legacy market-data dependency remains (${name})`);
  }
  if (/tradingview/i.test(name) && !/lightweight/i.test(name)) {
    errors.push(`package.json: TradingView Embed/widget dependency remains (${name})`);
  }
}

const lockfile = await readFile("pnpm-lock.yaml", "utf8");
for (const pattern of [/openapi\.koreainvestment\.com/i, /api\.upbit\.com/i, /KIS_APP_(?:KEY|SECRET)/i]) {
  if (pattern.test(lockfile)) errors.push(`pnpm-lock.yaml: legacy provider marker detected (${pattern})`);
}

if (errors.length) {
  console.error("Legacy market configuration validation failed:\n");
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log("Legacy market configuration validation passed.");
}
