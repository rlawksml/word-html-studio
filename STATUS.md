# 현재 상태와 작업 재개 — 2026-11-25 KST

- 저장소: https://github.com/rlawksml/word-html-studio (PUBLIC). 새 저장소를 만들지 않고 기존 이력을 유지한다.
- 확인 시점 GitHub main: 3affe71109f5c51a497c92c6bd7bdba8b679c6c5, develop: 10fae105dd45009c7815b3569e6688fc94dd96d8 (2026-11-25 재확인, 변화 없음).
- 주의: main/develop과 현재 운영 v1.1 소스는 다르다. 이전 운영 점검 기록의 v1.1 공개 버전은 1.1.0-rc.1 / 2bf2166이다. 2026-11-25에도 실제 배포 버전은 새로 조회하지 않았다.
- GitHub PR #95: codex/m5-release-flow (130be32508eaa2f8ff9af714d062e5ca4df45a08) → develop, OPEN, 2026-11-25 Ready 전환, mergeable clean. 아직 병합하지 않았다. 병합 여부는 사용자 결정 사항이다.
- GitHub PR #96: 이 인계 브랜치 → codex/m5-release-flow, Draft. #95 병합 후 base를 develop으로 바꿀지 재검토한다.
- 이 인계 문서의 작업 브랜치: codex/m5-cross-environment-handoff. 다른 컴퓨터에서는 이 브랜치를 먼저 읽되 제품 변경의 기준은 docs/RELEASE_FLOW.md와 실제 원격 PR 상태를 확인한다.
- 별도 staging-workspace에는 다른 작업의 미커밋 파일이 남아 있다. 그 폴더의 전체 변경이 GitHub에 있다고 가정하지 않는다.

## 2026-11-25 PR #95 검증 (130be32)

- 범위: 2bf2166은 130be32의 조상. 그 뒤 커밋 2개, 정책 9개 파일(+154/−8)만 변경. PR의 나머지 변경은 develop에 없는 운영 v1.1 이력(develop..2bf2166 120 커밋)이다.
- 로컬 Mac(apps/web, npm ci 후): lint PASS, typecheck PASS, build PASS, npm test 277/277 PASS.
- 추가: release-branch-policy 17/17, prepare-sites-source 11/11, rollback-preparation 17/17, migration:check PASS, git diff --check 2bf2166..130be32 PASS.
- GitHub Actions(Ready 전환 후): release-branch-policy success, verify success. 스테이징·Supabase 통합 작업은 이 PR에서 skipped.
- 참고: npm ci에서 moderate 취약점 16개(CI 기준은 production high라 비차단), allowScripts로 esbuild·workerd 등 install script 차단. 빌드·테스트는 영향 없음. 이후 wrangler dev/dry-run이 실패하면 workerd install script 승인을 확인한다.
- 실행하지 않음: 스테이징 배포, 스테이징 Supabase 통합, 운영 조회, 병합, 배포, DB/Storage 조작.
- 작업 환경 메모: 원격 세션의 git fetch/push와 GitHub 커넥터 쓰기는 403으로 막혀 커밋·push는 사용자 Mac 터미널에서 수행했다.

## 2026-11-25 v1.2 생성 HTML 개선 (이슈 #97~#100)

모두 #95 병합 전이라 운영 소스가 포함된 `codex/m5-release-flow`(130be32)에서 시작했다. 각 PR은 Ready 상태이며 병합하지 않았다.

| 이슈 | 브랜치 | PR | base | CI verify |
|---|---|---|---|---|
| #97 escape·사진 파일명 통일 | codex/v1.2-issue-97-html-escape-filenames | #101 | codex/m5-release-flow | success |
| #98 해 넘김 날짜·잘못된 월 | codex/v1.2-issue-98-cross-year-dates | #102 | codex/m5-release-flow | success |
| #99 표시 라벨 색 | codex/v1.2-issue-99-label-colors | #103 | codex/m5-release-flow | success |
| #100 ZIP 구성 분리 | codex/v1.2-issue-100-zip-builder-split | #104 | #97 브랜치(스택) | 첫 실행 1건 실패 후 수정, 재검증 결과는 PR 확인 |

- 상세 검증: `docs/test-reports/2026-11-25-issue97~100-*.md`(각 브랜치).
- 병합 순서: #95 → #101 → #104(base를 develop으로 변경) → #102 → #103. #101과 #102는 `lib/html-generators.ts` import 줄이 겹치므로 뒤에 병합하는 쪽을 갱신한다.
- 운영 HTML 문구가 바뀌는 #98·#99와 ZIP 동작을 건드린 #97·#100은 develop 통합 후 스테이징에서 확인한다. 운영 배포는 별도 승인.
- 작업 환경 메모: 이 세션은 저장소 push 권한으로 GitHub REST API와 git push가 가능했다. GraphQL(`gh pr`/`gh issue` 일부)은 막혀 REST(`gh api`)를 사용했다. npm 레지스트리 접근은 막혀 전체 회귀는 GitHub Actions `verify`로 확인했다.

## 다음 행동

1. 사용자 승인 시 PR #95를 develop에 병합한다. 병합 후 develop SHA를 이 문서에 기록한다.
1-1. #95 병합 후 v1.2 PR(#101~#104)의 base를 develop으로 바꾸고 위 순서로 검토·병합한다.
2. #96 base를 develop으로 바꿔 인계 문서를 통합할지 검토한다.
3. 이후 v1.2 작업은 병합된 develop에서 codex/v1.2-issue-<번호>-<작업명> 브랜치로 시작한다. 운영 반영은 docs/RELEASE_FLOW.md 순서와 별도 승인을 따른다.

읽는 순서: AGENTS.md → 이 문서 → docs/CROSS_ENVIRONMENT.md → docs/RELEASE_FLOW.md → TODO.md.
