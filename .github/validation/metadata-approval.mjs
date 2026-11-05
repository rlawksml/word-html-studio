// A recent operator check is a precondition, not a billing guarantee or an
// authorization grant. The parent must confirm the actual user approval.
import assert from "node:assert/strict";
export function requireTransferApproval(approved, checkedAt, now = Date.now()) {
  assert.equal(approved, "true");
  assert.ok(typeof checkedAt === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(checkedAt));
  const parsed = Date.parse(checkedAt);
  assert.ok(Number.isFinite(parsed) && new Date(parsed).toISOString() === checkedAt);
  assert.ok(Number.isFinite(now) && now >= parsed && now - parsed <= 60 * 60_000);
}
