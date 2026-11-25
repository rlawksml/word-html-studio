# #75 타입 검사 오류 수정 검증

- 기준: `1bd9798` + 본 보고서를 포함한 수정 커밋, `codex/issue-75-loading-feedback` / PR #76
- 환경: 로컬 격리 빌드·API mock. 실제 Supabase/Storage 쓰기 및 배포 없음.
- 원인: 경로 검증 함수의 명시적 type predicate 누락(3건), Cloudflare 런타임 타입 누락(3건), Vite `.ts` import 설정 불일치(1건).
- CI 누락 원인: 기존 `vinext build`와 ESLint는 전체 TypeScript semantic 검사를 대체하지 않으며 별도 tsc 단계가 없었음.

## 수정 범위

기존 경로 검사 조건은 유지하고 `value is string`만 명시했다. Cloudflare 공식 타입을 고정 개발 의존성으로 포함하고 선택적 D1 바인딩을 선언했다. 이 선언은 DB 생성·연결 변경이 아니다. Vite 설정은 같은 플러그인을 확장자 없는 import로 읽는다. 타입 검사 강도를 낮추거나 검사 대상을 제외하지 않았다. CI에 독립 `npm run typecheck` 필수 단계를 추가했다.

## 검증

| TC / 명령 | 결과 | 근거 |
|---|---|---|
| TC-TYPE-001 / `npm run typecheck` | PASS | 기존 7건 포함 타입 오류 0 |
| `npm run lint` | PASS | ESLint 오류 0 |
| TC-TYPE-002 / `npm test` | PASS | vinext build + Node 회귀 81/81 |
| `npm run audit:production` | PASS | 운영 의존성 취약점 0; 최초 DNS 제한 후 네트워크 허용 재실행 |
| `git diff --check` | PASS | 공백 오류 없음 |

설치 시 전체 개발 의존성 audit는 10건(4 moderate, 6 high)을 알렸다. 운영 의존성은 0건이며 이번 타입 수정에서 무관한 강제 의존성 업그레이드는 수행하지 않았다. 빌드의 큰 chunk 및 route static-classification 안내는 기존 경고다.

## 독립 QA 및 리뷰

- `PLAYWRIGHT_MODULE_PATH=<bundled playwright/index.mjs> node tests/browser-loading.mjs`: **11/11 PASS**. TC-AUTH-005·003, TC-SUB-012·007, TC-HTML-005 회귀. 360×740/360×420 화면 포함.
- pageErrors 0, escapedApiRequests 0. Console 21건은 의도한 실패·401 mock 시나리오에서 발생했으며 assertions 통과. 실제 DB/Storage 호출 없음.
- 최초 sandbox local listen EPERM 후 127.0.0.1 mock 서버 실행 권한으로 같은 테스트를 재실행했다.
- 독립 코드 리뷰 GO: 기존 검증 조건·저장소 연결·DB 설정 변화 없음. `cloudflare-env.d.ts`를 커밋에 포함한다.
- Workers ambient 타입과 기존 skipLibCheck 조합은 선언 충돌을 숨길 가능성이 있어 향후 타입 영역 분리 검토 대상이나, 현재 소스 타입 검사 및 빌드 실패는 없음.
- TC-TYPE-003: push 이후 GitHub Actions 결과를 Issue #75 / PR #76에 기록한다.

판정: 이번 타입 수정 **로컬 QA GO**. 실제 Staging 서명 쿠키·Supabase 통합 검증은 이번 로컬 검증과 구분하며, #75의 운영 배포 판정은 해당 검증 전까지 **NO-GO**다. 운영 데이터 변경 없음.
