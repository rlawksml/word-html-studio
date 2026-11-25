// Deliberately do not load .env.local, the SDK, Worker or the legacy suite.
import { assertLegacyIntegrationBlocked } from "./helpers/owned-cleanup-plan.mjs";

assertLegacyIntegrationBlocked();
