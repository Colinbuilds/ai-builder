// Writes the public tool definitions (no prompts) to site/tools.json for the web app.
// Run after editing src/tools.js:  npm run export-tools
import { writeFileSync } from "node:fs";
import { publicTools } from "../src/tools.js";

const out = new URL("../../site/tools.json", import.meta.url);
writeFileSync(out, JSON.stringify({ tools: publicTools() }, null, 2) + "\n");
console.log("wrote site/tools.json");
