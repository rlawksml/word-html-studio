import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const versionedWorkBranch = /^codex\/v\d+\.\d+(?:\.\d+)?-(?:issue-[1-9]\d*|task)-[a-z0-9]+(?:-[a-z0-9]+)*$/;

// Hosting is intentionally absent from Git routing. A passing PR never publishes.
export function checkReleaseBranch({ source, target, sourceRepo, targetRepo, prNumber }) {
  if (![source, target, sourceRepo, targetRepo].every((value) => typeof value === "string" && value)) {
    throw new Error("GitHub PR 브랜치 또는 저장소 정보가 누락됐습니다.");
  }
  if (target !== "main" && target !== "develop") return "feature-only";
  if (sourceRepo !== targetRepo) throw new Error("다른 저장소의 PR은 검토 후 내부 작업 브랜치로 가져오세요.");
  if (target === "develop") {
    // Preserve the already-open v1.1 baseline PR without renaming or rewriting shared history.
    const isBaselinePr = prNumber === 95 && source === "codex/m5-release-flow";
    if (isBaselinePr || versionedWorkBranch.test(source)) return "staging-source";
  }
  if (target === "main" && source === "develop") return "production-source";
  throw new Error(target === "main" ? "운영 PR은 develop → main만 허용합니다."
    : "개발 PR 브랜치 예: codex/v1.2-issue-123-save-draft 또는 codex/v1.2-task-release-docs");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const pr = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, "utf8")).pull_request;
  console.log(`RELEASE_BRANCH_PASS: ${checkReleaseBranch({
    source: pr?.head?.ref,
    target: pr?.base?.ref,
    sourceRepo: pr?.head?.repo?.full_name,
    targetRepo: pr?.base?.repo?.full_name,
    prNumber: pr?.number,
  })}`);
}
