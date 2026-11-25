# 현재 상태와 작업 재개 — 2026-11-25 KST

다른 컴퓨터·AI 환경에서는 AGENTS.md → 이 문서 → docs/CROSS_ENVIRONMENT.md → docs/RELEASE_FLOW.md → TODO.md 순서로 읽고, 원격 브랜치·PR 상태를 다시 확인한다.

## 현재 버전

| 환경 | 버전 | 소스 | 배포 대상 |
|---|---|---|---|
| 운영 | `1.1.0-rc.1` | `2bf2166` (마지막 운영 점검 기록 기준, 2026-11-25에는 재조회하지 않음) | `bookstore-news-studio-v11` Worker, 운영 Supabase |
| develop | v1.2 후보 (package 버전 표기는 아직 `1.1.0-rc.1`) | `0340775` | `bookstore-news-studio-staging` Worker 버전 `5e2753e5`, 스테이징 Supabase `kriyjyyudngtibrtkylf` |
| main | — | `3affe71` (2026-07-29) | 운영 소스 `2bf2166`보다 오래됐다. 운영 소스와 같다고 가정하지 않는다 |

- 저장소: https://github.com/rlawksml/word-html-studio (PUBLIC). 새 저장소를 만들지 않고 기존 이력을 유지한다.
- develop은 #95 병합(`55c2716`)으로 운영 v1.1 `2bf2166`을 포함하고, 그 위에 v1.2 PR 4개가 들어 있다.
- 별도 staging-workspace에는 다른 작업의 미커밋 파일이 남아 있다. 그 폴더의 전체 변경이 GitHub에 있다고 가정하지 않는다.

## v1.2 이슈 상태

| 이슈 | 내용 | PR | develop 커밋 | 상태 |
|---|---|---|---|---|
| #97 | 생성 HTML·ZIP escape 누락, 사진 파일명 규칙 통일 | #101 | `22eff8f` | develop 병합, 스테이징 배포 |
| #100 | HTML·사진 ZIP 구성을 controller에서 분리 | #104 | `4302ef1` | develop 병합, 스테이징 배포 |
| #98 | 해를 넘기는 날짜·잘못된 월 표시 보완 | #102 | `74f27b2` | develop 병합, 스테이징 배포 |
| #99 | 표시 라벨 상태별 색 구분 | #103 | `0340775` | develop 병합, 스테이징 배포 |

- 각 PR은 CI verify success 후 squash 병합했다. 앞 PR 병합 후 뒤 브랜치에는 강제 push 없이 develop을 merge해 갱신했다(#104는 #97 squash 중복, #102는 import 한 줄 충돌을 정리).
- 이슈 #97~#100은 운영 반영 전까지 열어 둔다. 병합 결과는 각 이슈 댓글에 있다.
- v1.2는 DB 스키마·SQL·저장 API·Supabase·배포 설정 파일을 바꾸지 않았다. 바뀐 것은 HTML 생성 결과, ZIP 구성, 날짜 표시, 라벨 색, 테스트와 문서다.
- 상세: `docs/test-reports/2026-11-25-issue97-html-export-safety.md`, `…issue98-cross-year-dates.md`, `…issue99-label-colors.md`, `…issue100-zip-plan.md`

## 스테이징 검증 (2026-11-25)

- develop `0340775`를 Mac의 Claude Code 세션에서 `wrangler deploy --config wrangler.staging.json`으로 `bookstore-news-studio-staging`에 배포했다(버전 `5e2753e5`). 운영 Worker·운영 DB·사진, 마이그레이션·SQL·Storage 정리는 실행하지 않았다.
- 앱 테스트 284/284, 스테이징 Worker 테스트 36/36 PASS.
- **브라우저 UI 확인 BLOCKED**: 스테이징 Worker가 `workers_dev: false`, `routes: []`라 외부에서 열리지 않는다(Cloudflare 1042). 2026-11-06 배포부터 같은 상태였다.
- 상세: `docs/test-reports/2026-11-25-0340775-v1.2-staging-deploy.md`

## 이전 기록: PR #95 운영 기준선 정합화

- `codex/m5-release-flow`(`130be32`)는 운영 `2bf2166` 위에 정책 커밋 2개(9개 파일)만 더한 브랜치였다. 로컬 lint·typecheck·build·test 277/277, CI verify success 후 2026-11-25 사용자 승인으로 merge commit 병합(`55c2716`).
- 병합 전 develop push로 배포되는 워크플로가 없음을 확인했다(CI push 트리거는 main뿐).
- 인계 문서 PR #96은 이 브랜치(`codex/v1.2-task-staging-deploy-verify`)에 합쳐 develop 통합 경로로 옮겼다. #96의 브랜치 이름은 develop PR 이름 규칙과 맞지 않았다.

## ⚠️ 위험 사항 (2026-11-25 확인)

| 위험 | 현재 상태 | 지키는 방법 |
|---|---|---|
| 로컬 개발 서버가 운영 DB에 연결됨 | Mac `apps/web/.env.local`의 `SUPABASE_URL`이 **운영 Supabase `kdigttaghqubfjsmbngl`**이고 관리자 키(`SUPABASE_SECRET_KEY`)가 함께 있다. 스테이징용 env 파일은 Mac에 없다 | 이 상태로 `npm run dev`·로컬 통합 테스트·브라우저 확인을 하지 않는다. 로그인 후 저장·사진 업로드·완료 처리가 운영 DB와 Storage를 바꾼다. 로컬 화면 확인 전 `.env.local`을 백업하고 **스테이징 `kriyjyyudngtibrtkylf`** 값으로 바꾼 뒤, 시작 전에 URL의 프로젝트 이름을 확인한다. 원래 파일 복원도 확인한다 |
| `--config` 없는 wrangler 배포 | 빌드 결과물의 기본 Worker 이름이 `bookstore-news-studio-web`이다 | 스테이징은 `--config wrangler.staging.json`(`bookstore-news-studio-staging`)으로만 배포한다. 운영 `bookstore-news-studio-v11` 배포는 별도 승인과 RELEASE_FLOW 절차를 따른다 |
| AI 세션이 운영까지 진행 | 2026-11-25 Mac의 Claude Code 세션은 스테이징까지만 진행했다(운영 미접촉 확인) | 세션 시작 요청에 "스테이징까지만, 운영 Worker·main·DB 마이그레이션 금지, 배포 전 대상 Worker와 SUPABASE_URL 표시"를 넣는다. 승인 화면에서 대상 이름을 확인한다 |
| 스테이징 URL 공개 | 스테이징 Worker는 `workers_dev: false`, `routes: []`라 외부 접근이 막혀 있다 | 열 때는 별도 승인 후 `/__staging/login` 입장 게이트가 막는지 먼저 확인한다 |

## 작업 환경 메모

- claude.ai 클라우드 세션: 저장소 push 권한으로 git push와 GitHub REST(`gh api`)가 된다. GraphQL(`gh pr`, `gh issue` 일부)과 npm 레지스트리, Cloudflare·workers.dev는 막혀 있어 전체 회귀는 GitHub Actions `verify`로 확인했다.
- Mac 로컬의 Claude Code(데스크톱 앱 Code 탭 또는 CLI): Mac의 wrangler 로그인과 `.env.local`을 쓰므로 스테이징 배포는 여기서 한다. 배포 명령은 반드시 `--config wrangler.staging.json`이어야 한다. `--config` 없는 `wrangler deploy`는 기본 이름 `bookstore-news-studio-web`으로 새 Worker를 만든다.

## 다음 행동

1. **[결정 필요] 스테이징 브라우저 확인**: 스테이징 URL 접근을 열지 결정한다. 여는 경우 `/__staging/login` 입장 게이트가 막아주는지 먼저 확인하고, HTML 미리보기·복사, 사진 ZIP 다운로드·압축 해제, 12월호 해 넘김 날짜, 마감·종료 라벨 색을 본다.
2. **develop → main 릴리스 PR**: 브라우저 확인 후 `release(v1.2.0): …`로 만든다. 릴리스 PR은 squash하지 않는다. 운영 백업과 롤백 대상 기록(docs/ROLLBACK_PREPARATION.md)을 확인한다.
3. **운영 배포**: 별도 사용자 승인 후 기존 `bookstore-news-studio-v11` Worker에만 반영하고 `/api/version`으로 배포 SHA를 대조한다. 배포 후 이슈 #97~#100을 닫는다.
