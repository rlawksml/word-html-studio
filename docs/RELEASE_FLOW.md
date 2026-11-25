# 동네책방 소식 스튜디오 릴리스 운영

GitHub `rlawksml/word-html-studio`가 앱 소스의 기준이다. 배포 플랫폼은 승인한 소스를 실행하는 곳이며, 플랫폼을 바꿔도 브랜치 전략은 같다.

| GitHub 브랜치 | 역할 | 반영 대상 |
|---|---|---|
| `codex/v1.2-issue-123-save-draft` | 목표 버전·이슈·변경 내용이 드러나는 작업 브랜치 | `develop` PR. 필요할 때만 별도 테스트 브랜치 사용 |
| `develop` | 개발 통합 | [비공개 스테이징](https://bookstore-news-studio-staging.rlawksml.workers.dev/)과 스테이징 Supabase |
| `main` | 사용자 승인 릴리스 소스 | [고정 운영 주소](https://bookstore-news-studio-v11.rlawksml.workers.dev/)의 기존 `bookstore-news-studio-v11` Worker |

## 이름 규칙

- 브랜치: `codex/<목표 버전>-issue-<번호>-<영문-작업명>`. 이슈 번호가 없으면 `codex/v1.2-task-release-docs`처럼 `task`를 쓴다. 패치 대상이면 `v1.2.1`처럼 적는다.
- 커밋과 PR: `fix(v1.2): 초안 저장 오류 수정 (#123)`처럼 변경 유형·목표 버전·내용·이슈 번호를 맞춘다. `feat`, `fix`, `docs`, `ci`, `test` 등을 쓰고, 이슈가 없으면 번호를 빼면 된다. squash 커밋 제목에도 이 형식을 유지한다.
- 릴리스: `develop → main` PR 제목과 배포 기록에는 정확한 버전을 쓴다. 예: `release(v1.2.0): 동네책방 소식 스튜디오 배포`. 배포 후 Git 태그(예: `v1.2.0`)는 실제 운영이 반환한 소스 SHA에 붙인다. 아직 배포하지 않았거나 `-rc.1`로 운영 중인 버전을 안정판 태그로 바꾸지 않는다.
- `main`·`develop`은 버전마다 새로 만들지 않는다. 과거 공유 커밋·PR의 이름은 바꾸지 않는다. 기존 v1.1 기준선 [PR #95](https://github.com/rlawksml/word-html-studio/pull/95)만 이름 검사 예외다. 다른 과거 PR을 계속 진행할 경우 새 규칙 이름의 브랜치로 연결한다.

## 브랜치와 커밋 운영 규칙

- **PR을 쌓지 않는다.** 다른 PR에 의존하는 작업은 앞 PR이 `develop`에 병합된 뒤 최신 `develop`에서 새 브랜치를 만든다. 기능 PR은 squash로 병합하므로, 쌓은 브랜치는 같은 내용이 다른 커밋으로 다시 들어와 충돌한다(2026-11-25 #104 사례).
- **같은 파일을 고치는 작은 수정 여러 개는 한 이슈로 묶는 것을 먼저 검토한다.** 나눌 때는 병합 순서를 PR 본문에 적고, 뒤 브랜치는 강제 push 없이 최신 `develop`을 merge해 갱신한 뒤 CI 통과를 확인하고 병합한다.
- **상태 기록은 그 작업의 PR 안에서 한다.** STATUS.md·테스트 보고서·TODO 갱신을 별도 브랜치나 별도 PR로 미루지 않는다. 기록만 남는 작업은 `codex/<버전>-task-<작업명>` 하나로 모은다. STATUS.md는 `develop`에 하나만 둔다.
- **병합 방식**: 기능·문서 PR → `develop`은 squash, `develop → main` 릴리스 PR은 merge commit.
- **병합된 브랜치는 지운다.** 저장소의 병합 후 브랜치 자동 삭제를 켜 두고, 남은 브랜치는 병합 여부를 확인한 뒤 정리한다.

## 한 릴리스를 올리는 순서

1. 최신 `develop`에서 이슈별 브랜치를 만들고 PR을 연다. 브랜치 검사·이슈 TC·필요한 회귀를 통과한 PR을 `develop`에 병합한다. GitHub Actions는 코드 검증만 한다. Draft 상태에서는 가벼운 브랜치 정책 검사만 하고, Ready로 바꾸면 전체 앱 검증을 실행한다. 바뀐 파일이 모두 Markdown(`.md`)인 PR은 앱 검증(`verify-app`)을 건너뛰고, 필수 검사 `verify`는 그 사실을 확인해 통과로 보고한다. `.md`가 아닌 파일이 하나라도 있거나 파일 목록을 확인하지 못하면 전체 검증한다.
2. 릴리스 후보 `develop`의 정확한 SHA로 [분리 스테이징](CLOUDFLARE_STAGING.md)을 검증한다. 설정이 스테이징 Supabase를 가리키는지 확인한 뒤 필요한 시나리오만 실행한다. 테스트에 운영 DB/Storage를 연결하지 않는다.
3. 릴리스 PR 전에 `apps/web/package.json`의 `version`을 릴리스 버전(예: `1.2.0`)으로 올리는 작업을 `develop`에 반영한다. 검증 결과와 스테이징 SHA를 기록하고 `develop → main` PR에서 운영 승인을 받는다. 릴리스 PR은 squash하지 않는다. 머지 과정에서 별도 커밋이 생기면 스테이징에서 검증한 커밋이 `main`에 포함되고 두 소스 트리가 같은지 확인한다. 다르면 다시 검증한다.
4. 배포 승인을 받으면 해당 검증 소스, 실제 현재 운영 Worker의 불변 버전 ID, 기존 환경 설정, 무료 실행 범위를 대조한다. 로컬의 검증 빌드만 기존 Worker에 반영한다. 기본 생성 `wrangler.json`으로 임의 배포하거나 Worker·URL을 만들지 않는다. 이 흐름은 자동 배포나 클라우드 요금제 변경을 설정하지 않는다.
5. 공개 주소의 [`/api/version`](https://bookstore-news-studio-v11.rlawksml.workers.dev/api/version)에서 실제 배포 SHA와 스키마 호환을 대조하고 GitHub 릴리스 기록에 배포 SHA·Worker 버전·검증 결과를 남긴다. 장애 시 호환되는 직전 앱 배포본을 같은 Worker에서 복구한다. DB·사진을 롤백하지 않는다.

머지나 앱 배포는 DB 마이그레이션·사진 정리를 실행하지 않는다. 스키마 변경이 필요한 경우에만 백업·이전 앱 호환 검증과 별도 승인을 거친다. 운영 백업과 환경 비밀값은 GitHub에 올리지 않는다. 자세한 복구 준비는 [롤백 가이드](ROLLBACK_PREPARATION.md)를 따른다.

## Sites를 배포 대상으로 쓰는 경우

같은 `codex/* → develop → main` 절차를 유지한다. 승인한 GitHub 커밋에서 배포 소스만 준비해서 [Sites 소스 검증](SITES_SOURCE_ADAPTER.md)을 거친다. Sites가 별도의 배포용 Git 커밋을 만들면 GitHub 원본 SHA와 Sites 소스 SHA를 함께 기록한다. Sites 편집 화면을 독립적인 운영 소스로 쓰지 않는다. 기존 v1.0 Sites는 보존하며 이 설정으로 복구·게시하거나 운영 대상으로 되돌리지 않는다.

## 현재 운영 소스 정합화

2026-11-16 공개 운영 버전에서 `1.1.0-rc.1` / `2bf2166cfbfc4f10f430b5d1b8b3d243e2a5cd59` / 스키마 현재·기대 `202609070002`를 확인했다. 최초 정합화는 이 이미 배포된 소스의 Git 이력과 운영 절차를 맞추는 작업이다. 기존 환경 변경·재배포·DB 마이그레이션은 포함하지 않는다. 정책 설정 PR의 테스트는 릴리스 경로 설정에 한정되며, 새 애플리케이션 버전의 배포 판정이 아니다.
