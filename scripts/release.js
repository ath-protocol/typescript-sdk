#!/usr/bin/env node

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const bump = process.argv[2];
if (!["patch", "minor", "major"].includes(bump)) {
  console.error("Usage: pnpm run release <patch|minor|major>");
  process.exit(1);
}

function run(cmd) {
  console.log(`$ ${cmd}`);
  execSync(cmd, { stdio: "inherit" });
}

run(`pnpm --filter "@ath-protocol/*" exec -- npm version ${bump} --no-git-tag-version`);

const { version } = JSON.parse(
  readFileSync("packages/types/package.json", "utf-8"),
);
const tag = `v${version}`;

console.log(`\nReleasing ${tag}\n`);

run("git add -A");
run(`git commit -m "release: ${tag}"`);
run(`git tag ${tag}`);
run("git push origin main --follow-tags");

console.log(
  `\nDone — pushed ${tag}. GitHub Actions will publish to NPM automatically.`,
);
