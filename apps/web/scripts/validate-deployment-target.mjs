import { readFile } from "node:fs/promises";
import { assertHostingProjectForTarget } from "./deployment-target-policy.mjs";

const target = process.env.DEPLOYMENT_TARGET
  || process.env.GITHUB_BASE_REF
  || process.env.GITHUB_REF_NAME;
const hosting = JSON.parse(await readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"));
const normalized = assertHostingProjectForTarget({ target, projectId: hosting.project_id });

console.log(`DEPLOYMENT_TARGET_PASS: ${normalized}`);
