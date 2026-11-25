# HTML 줄바꿈 수정 검증 — #82

- 브랜치: `codex/m1-html-line-breaks` (기준 `d7f38ae`)
- 범위: 출력 formatter/generator, 합성 fixture 테스트. DB/API/클립보드 경로 변경 없음.
- 원인 근거: 기존 생성기가 본문의 개행을 CSS `white-space:pre-line`에 의존했다. 복사 경로는 생성 결과를 그대로 전달한다. 외부 편집기가 해당 CSS를 무시/제거했는지는 직접 재현하지 않아 추정으로 남긴다.
- 변경: 먼저 HTML escape 후 CRLF/CR/LF를 `<br>`로 변환. 빈 줄은 `<br><br>` 유지. 속성·URL·제목에는 적용하지 않는다. 사진 미리보기/내보내기 차이는 기존 정책 유지.

## 실행 결과

| 명령/TC | 결과 |
|---|---|
| `node --test tests/html-line-breaks.test.mjs` | 5/5 PASS, 독립 QA 재실행 PASS |
| `npm test` (빌드 포함) | 87/87 PASS, skip 0 |
| `npm run lint` | PASS |
| `npm run typecheck` | PASS |
| `git diff --check` | PASS |
| HTML-LINES-01~05 | PASS: 개행/빈줄/이모티콘/escaping/본문 일치/원본 불변/속성 분리 |
| HTML-LINES-06 실제 외부 편집기 붙여넣기 | NOT RUN: 배포 및 실제 대상 편집기 검증 별도 필요 |

첫 빌드는 샌드박스가 프로젝트의 `.vite-temp` 쓰기를 차단하여 EPERM으로 중단됐다. 로컬 빌드 파일 쓰기 권한으로 다시 실행한 전체 빌드·테스트는 통과했다. 애플리케이션 실패로 집계하지 않는다.

## 데이터 안전 및 판정

- 실제 DB·Storage·운영 로그인·사용자 원본에 접근/변경하지 않았다. 합성 객체만 사용하므로 정리할 원격 테스트 데이터 없음.
- README/TODO/TC 및 기본 `npm test` 목록에 신규 회귀 검증을 추가했다.
- 로컬 코드 검증 GO. 원격 배포·실제 편집기 호환성은 미검증이며 배포/머지 승인으로 해석하지 않는다.
- 코드 미배포: 현재 서비스에는 아직 이 수정이 적용되지 않았다.
