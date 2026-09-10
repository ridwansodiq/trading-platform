#!/usr/bin/env node
/**
 * Drift check for backend-generated artifacts.
 *
 * Hashes the committed OpenAPI document and generated client, regenerates both,
 * then fails if anything moved. Runs on content hashes rather than `git diff`
 * so it behaves the same in CI, in a fresh clone, and outside a git work tree.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const TRACKED = ["openapi/openapi.json", "frontend/src/api/generated"];

function walk(path, files = []) {
  let info;
  try {
    info = statSync(path);
  } catch {
    return files;
  }
  if (info.isDirectory()) {
    for (const entry of readdirSync(path).sort()) walk(join(path, entry), files);
  } else {
    files.push(path);
  }
  return files;
}

function fingerprint() {
  const entries = new Map();
  for (const target of TRACKED) {
    for (const file of walk(target)) {
      const key = relative(process.cwd(), file).split(sep).join("/");
      entries.set(key, createHash("sha256").update(readFileSync(file)).digest("hex"));
    }
  }
  return entries;
}

const before = fingerprint();

execFileSync("npm", ["run", "api:generate"], { stdio: "inherit" });

const after = fingerprint();

const changed = [];
for (const [file, hash] of after) {
  if (before.get(file) !== hash) changed.push(before.has(file) ? `modified: ${file}` : `added:    ${file}`);
}
for (const file of before.keys()) {
  if (!after.has(file)) changed.push(`removed:  ${file}`);
}

if (changed.length > 0) {
  console.error("\nGenerated API artifacts are out of date:\n");
  for (const line of changed.sort()) console.error(`  ${line}`);
  console.error(
    "\nThe backend route schemas are the source of truth. The files above have" +
      "\njust been regenerated — review and commit them.\n"
  );
  process.exit(1);
}

console.log(`\nGenerated API artifacts are current (${after.size} files checked).`);
