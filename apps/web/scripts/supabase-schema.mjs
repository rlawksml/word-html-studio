export const SUPABASE_TABLE_SPECS = [
  { name: "bookstores", orderColumns: ["id"], legacyRequired: true },
  { name: "submissions", orderColumns: ["id"], legacyRequired: true },
  { name: "editing_leases", orderColumns: ["resource_key"], legacyRequired: true },
  { name: "improvement_requests", orderColumns: ["id"], legacyRequired: true },
  { name: "app_schema_versions", orderColumns: ["component"], legacyRequired: false },
  { name: "news_schedule_ranges", orderColumns: ["submission_id", "news_item_id"], legacyRequired: false },
];

export function isMissingTableError(error) {
  return error?.code === "PGRST205" || error?.code === "42P01";
}

export function tableSpecsForBackup(schemaVersionAvailable) {
  return SUPABASE_TABLE_SPECS.filter((table) => table.legacyRequired || schemaVersionAvailable);
}

export function tableSpecsForRestore(databaseManifest) {
  const expectedNames = new Set(Object.keys(databaseManifest || {}));
  const knownNames = new Set(SUPABASE_TABLE_SPECS.map((table) => table.name));
  const unknown = [...expectedNames].filter((name) => !knownNames.has(name));
  if (unknown.length > 0) throw new Error(`Backup contains unsupported tables: ${unknown.join(", ")}`);
  return SUPABASE_TABLE_SPECS.filter((table) => expectedNames.has(table.name));
}
