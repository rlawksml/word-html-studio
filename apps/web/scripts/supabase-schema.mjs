export const SUPABASE_TABLE_SPECS = [
  { name: "bookstores", orderColumns: ["id"], legacyRequired: true },
  { name: "submissions", orderColumns: ["id"], legacyRequired: true },
  { name: "editing_leases", orderColumns: ["resource_key"], legacyRequired: true },
  { name: "improvement_requests", orderColumns: ["id"], legacyRequired: true },
  { name: "app_schema_versions", orderColumns: ["component"], legacyRequired: false },
  { name: "news_schedule_ranges", orderColumns: ["submission_id", "news_item_id"], legacyRequired: false },
  { name: "monthly_digest_orders", orderColumns: ["month"], legacyRequired: false, capability: "digest_order" },
];

export const DIGEST_ORDER_SCHEMA_COMPONENT = "digest_order";
export const DIGEST_ORDER_SCHEMA_VERSION = 202611040001;

// 특정 marker 테이블의 정확한 부재만 legacy 미설치로 인정합니다.
export function isMissingSchemaVersionTableError(error) {
  if (typeof error?.message !== "string") return false;
  const pattern = error.code === "PGRST205"
    ? /^Could not find the table 'public\.app_schema_versions' in the schema cache\.?$/i
    : error.code === "42P01" ? /^relation "(?:public\.)?app_schema_versions" does not exist\.?$/i : null;
  const match = pattern?.exec(error.message);
  return Boolean(match && match[0] === error.message);
}

// Backup과 API가 같은 capability 판정을 사용합니다. SDK/키/env 의존성은 없습니다.
export async function readSupabaseSchemaCapabilities(client, execute = async (operation) => operation()) {
  let result;
  try {
    result = await execute(() => client.from("app_schema_versions").select("component,version")
      .eq("component", DIGEST_ORDER_SCHEMA_COMPONENT).maybeSingle());
  } catch { throw new Error("SCHEMA_CAPABILITY_QUERY_FAILED"); }
  if (!result || typeof result !== "object" || !("error" in result)) throw new Error("SCHEMA_CAPABILITY_QUERY_FAILED");
  if (result.error) {
    if (isMissingSchemaVersionTableError(result.error)) return { schemaVersionAvailable: false, digestOrderAvailable: false };
    throw new Error("SCHEMA_CAPABILITY_QUERY_FAILED");
  }
  if (result.data === null) return { schemaVersionAvailable: true, digestOrderAvailable: false };
  if (result.data?.component !== DIGEST_ORDER_SCHEMA_COMPONENT || result.data?.version !== DIGEST_ORDER_SCHEMA_VERSION) {
    throw new Error("DIGEST_ORDER_SCHEMA_VERSION_UNSUPPORTED");
  }
  return { schemaVersionAvailable: true, digestOrderAvailable: true };
}

export function isMissingTableError(error) {
  return error?.code === "PGRST205" || error?.code === "42P01";
}

export function tableSpecsForBackup(schemaVersionAvailable, digestOrderAvailable = false) {
  if (typeof schemaVersionAvailable !== "boolean" || typeof digestOrderAvailable !== "boolean") throw new Error("SCHEMA_CAPABILITY_FLAGS_INVALID");
  if (digestOrderAvailable && !schemaVersionAvailable) throw new Error("DIGEST_ORDER_MARKER_REQUIRED");
  return SUPABASE_TABLE_SPECS.filter((table) => table.legacyRequired
    || (table.capability === "digest_order" ? digestOrderAvailable : schemaVersionAvailable));
}

export function tableSpecsForRestore(databaseManifest) {
  const expectedNames = new Set(Object.keys(databaseManifest || {}));
  const knownNames = new Set(SUPABASE_TABLE_SPECS.map((table) => table.name));
  const unknown = [...expectedNames].filter((name) => !knownNames.has(name));
  if (unknown.length > 0) throw new Error(`Backup contains unsupported tables: ${unknown.join(", ")}`);
  return SUPABASE_TABLE_SPECS.filter((table) => expectedNames.has(table.name));
}
