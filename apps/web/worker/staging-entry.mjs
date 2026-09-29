// Independent staging deployment only: authenticate before any application route.
import application from "../dist/server/index.js";
import { createStagingGate } from "./staging-gate.mjs";

export default createStagingGate(application);
