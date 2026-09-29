// Independent staging deployment only: authenticate before any application route.
import application from "../dist/server/index.js";
import { createStagingGate } from "./staging-gate.mjs";
import { createStagingAssetAdapter } from "./staging-assets.mjs";

export default createStagingGate(createStagingAssetAdapter(application));
