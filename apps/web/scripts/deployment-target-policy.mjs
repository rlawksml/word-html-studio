export const SITE_PROJECT_IDS = Object.freeze({
  production: "appgprj_6a5dbe2598fc8191a1c25c37e759c6ae",
  staging: "appgprj_6a9e5e7aea3c8191a70eae751c212394",
});

export function normalizeDeploymentTarget(value) {
  if (value === "main" || value === "production") return "production";
  if (value === "develop" || value === "staging") return "staging";
  return "";
}

export function assertHostingProjectForTarget({ target, projectId }) {
  const normalized = normalizeDeploymentTarget(target);
  if (!normalized) throw new Error(`알 수 없는 배포 대상입니다: ${target || "(비어 있음)"}`);
  const expected = SITE_PROJECT_IDS[normalized];
  if (projectId !== expected) {
    throw new Error(`${normalized} 배포 대상과 .openai/hosting.json project_id가 일치하지 않습니다.`);
  }
  return normalized;
}
