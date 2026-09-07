import { verifyBackupDirectory } from "./backup-utils.mjs";

const result = await verifyBackupDirectory(process.argv[2]);
console.log(JSON.stringify({
  status: result.status,
  manifestSha256: result.manifestSha256,
  verifiedFiles: result.verifiedFiles,
  verifiedBytes: result.verifiedBytes,
  failures: result.failures,
}, null, 2));
if (result.status !== "PASS") process.exitCode = 1;
