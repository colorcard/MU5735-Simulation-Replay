import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const source = resolve(root, "data", "web_payload");
const target = resolve(root, "app", "public", "data");

if (!existsSync(source)) {
  throw new Error(`Missing source data directory: ${source}`);
}

rmSync(target, { recursive: true, force: true });
mkdirSync(resolve(root, "app", "public"), { recursive: true });
cpSync(source, target, { recursive: true });
console.log(`Synced ${source} -> ${target}`);
