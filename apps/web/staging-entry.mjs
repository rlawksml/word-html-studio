// Independent staging deployment only: authenticate before any application route.
// Wrangler uploads the entry by basename; keep it at base_dir to preserve import paths.
import application from "./dist/server/index.js";
import { createStagingGate } from "./worker/staging-gate.mjs";
import { createStagingAssetAdapter } from "./worker/staging-assets.mjs";

export default createStagingGate(createStagingAssetAdapter(application));
