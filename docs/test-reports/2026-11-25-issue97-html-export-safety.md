# Issue #97 생성 HTML·ZIP escape와 사진 파일명 — 2026-11-25

- 기준: `codex/m5-release-flow` `130be32`(운영 v1.1 `2bf2166` 포함). 브랜치 `codex/v1.2-issue-97-html-escape-filenames`.
- 데이터: 합성 값만 사용. DB·Storage·운영 세션 변경 없음.

## 변경

- `lib/workspace-formatters.ts`: `newsImageFilename`(공용 사진 파일명), `imageFilenameExtension`(jpg·jpeg·png·webp·gif·heic·heif만 원래 표기로 유지, 그 외·없음은 `jpg`), `safeFilename`의 50 UTF-16 단위 상한을 유지하면서 서로게이트 쌍을 자르지 않도록 수정.
- `lib/html-generators.ts`: 복사용 HTML 주석이 공용 파일명을 사용하고 미리보기 `<img src>`를 escape.
- `hooks/use-studio-controller.ts`: ZIP 사진 파일과 사진배치안내가 공용 파일명을 사용하고 ZIP HTML `<title>`을 escape.
- 호환: 지원 확장자의 정상 파일명과 50단위 이내 제목의 결과는 바뀌지 않는다. 바뀌는 경우는 비지원·없는 확장자(`jpg`로 고정)와 이모지가 경계에서 잘리던 제목뿐이다.

## 검증

| 항목 | 결과 |
|---|---|
| HTML-SAFE-01~03, 수정 전 코드 | 0/3 PASS (의도한 RED) |
| HTML-SAFE-01~03, 수정 후 | 3/3 PASS |
| HTML-LINES-01~05, 수정 후 | 5/5 PASS |
| lint·typecheck·build·전체 `npm test` | GitHub Actions `verify`에서 확인 (PR 기록 참조) |

로컬 실행은 Node 22 `--experimental-strip-types`로 실제 TS 소스를 불러온 동일 단언이다. 작업 환경에서 npm 레지스트리 접근이 차단돼 esbuild 번들 방식(HTML-LINES-07 포함)과 전체 회귀는 CI 결과를 기준으로 한다.

## 남은 위험

- 외부 게시판 편집기에 실제로 붙여넣는 HTML-LINES-06 수동 확인은 이번 범위가 아니다.
- 운영 반영은 develop 통합·스테이징 검증·별도 승인 후 진행한다.
