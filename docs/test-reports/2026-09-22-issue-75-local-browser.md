# #75 로딩·세션 통합 검증 — 2026-09-22

## 판정

로컬 변경 기능 검증 PASS, 배포 NO-GO. 기존 TypeScript 오류 7건과 Staging 실연결 인증 검증이 남아 있다. Production·Staging DB/Storage/세션을 변경하지 않았으며 Staging은 version 15를 유지한다.

## 대상과 통합

- PR #76, `codex/issue-75-loading-feedback`.
- `develop@10fae10` 병합 후 기존 Staging의 #73 저장 응답 수렴과 #72 메인 이동 세션 보존 수정을 함께 보존했다.
- 독립 리뷰가 발견한 로그아웃 DELETE와 재로그인 경쟁, Workspace 무한 대기를 수정했다. 로그아웃은 응답을 기다리며 실패하면 작업 화면과 재시도를 유지한다. 로그인 POST와 Workspace에는 각각 12초, 세션 복귀 GET·로그아웃에는 10초 제한을 둔다.
- `.mjs`의 선언 파일을 `.d.mts`로 맞춰 이번 변경의 제네릭 타입 해석 오류를 해소했다.
- 로그아웃 전에 편집 임대를 최대 3초간 해제하고 중복 cleanup을 억제한다. 확정 실패는 임대를 재확인하고, 응답 유실·임대 재획득 실패는 복구본을 보존한 뒤 로컬 세션을 종료한다. 저장하지 않고 로그아웃 실패를 성공 알림으로 덮던 경로도 수정했다.
- 처음 사용한 node_modules 심볼릭 링크가 lockfile과 다른 Vite 8.0.13을 가리켰다. 링크만 제거하고 독립 `npm ci`로 Vite 8.2.2를 설치한 뒤 다시 검증했다. 원래 프로젝트의 node_modules는 변경하지 않았다.

## 실행 결과

| 검증 | 결과 | 근거 |
|---|---|---|
| 전체 회귀·build | PASS | `npm test`: 81/81 |
| lint | PASS | `npm run lint` |
| 공백·패치 | PASS | `git diff --check` |
| 운영 의존성 audit | PASS | `npm audit --omit=dev --json`: 취약점 0 |
| TypeScript | FAIL | 아래 기존 오류 7건 |
| 실제 Supabase 통합 | SKIPPED | 로컬 환경 파일이 Production 연결이므로 실행하지 않음 |
| Staging 배포 후 UAT | BLOCKED | 이번 배포를 진행하지 않음 |

`tests/browser-loading.mjs`는 실제 빌드 Worker를 로컬 HTTP로 렌더링하고 Playwright Chromium으로 조작한다. 브라우저의 모든 API는 메모리 fixture로 응답하며, mock 밖으로 빠져나간 API 요청은 **0건**이다. 외부 origin은 차단한다. 실제 암호·쿠키·키·사용자 데이터는 사용하지 않는다.

| 시나리오 | 결과 | 관찰 |
|---|---|---|
| TC-AUTH-005 지연·중복 로그인 | PASS | 350ms 인증, 450ms Workspace 지연에서 단계 표시·입력 비활성화, POST 1회 |
| TC-AUTH-003 메인 이동·기존 세션 복귀 | PASS | 암호 재입력 없이 GET 1회로 복귀, POST 추가 없음 |
| TC-AUTH-005 로그아웃 | PASS | 지연 중 표시, 400 실패 시 탭 세션 유지, 재시도 후 제거 |
| TC-AUTH-005 Workspace 실패 | PASS | 400 후 조건부 DELETE, 탭 세션 제거·암호 필드 포커스 복귀·재로그인 성공 |
| TC-SUB-012 저장·완료·이탈 | PASS | 저장 400 후 입력 유지, 이탈 저장 실패 후 계속 작성 포커스, 재완료 시 입력 inert 및 목록 복귀 |
| TC-SUB-012 변경 버리기·로그아웃 실패 | PASS | 400 실패 안내 유지, 성공 토스트 없음, 편집 임대 재획득 확인 |
| TC-SUB-007 변경 버리기·응답 유실 | PASS | 입력자 로그아웃 응답 유실 후 복구본 없음, 재로그인 후 버린 입력 미복구 |
| TC-HTML-005 ZIP | PASS | 두 버튼 잠금, 원본 404 후 재시도, 작업파일 ZIP 다운로드 이벤트·파일명 확인 |
| TC-AUTH-005 로그아웃 응답 유실 | PASS | mock 서버 세션 종료 뒤 응답을 끊어도 로컬 세션 제거·방문자 전환 |
| TC-AUTH-005 timeout·모바일 | PASS | Workspace 16초 지연 시 19초 이내 잠금 해제·세션 정리, 360×420 모달 경계 확인 |
| TC-AUTH-005 반복 실패·리소스 | PASS | 12회 실패·닫기, GC 후 4·8·12회 표본 비교 |

브라우저 시나리오 묶음 11 PASS. JavaScript pageerror 0건. Console error 21건은 의도한 HTTP 400 6건·401 12건·404 1건 및 로그아웃 응답 유실 2건과 수가 일치한다. 이를 실제 서비스 오류나 오류 0건으로 오해하면 안 된다. 정상 응답은 200 28건·204 14건이었다. API 호출 누계는 session POST 18·GET 1·DELETE 8, submission PUT 4, 원본 이미지 GET 3이다. 인증을 잃은 presence는 mock도 401을 반환하도록 검증했으며 최종 실행의 401은 모두 의도한 암호 실패 12회였다. 로그아웃 이후 sessionId가 없는 effect cleanup은 서버 해제 요청을 보내지 않는다.

### 리소스 표본과 한계

| 실패 반복 횟수 | Documents | DOM Nodes | Event listeners | JS heap bytes |
|---:|---:|---:|---:|---:|
| 4 | 2 | 299 | 212 | 4,945,052 |
| 8 | 2 | 299 | 212 | 4,992,040 |
| 12 | 2 | 299 | 212 | 4,988,844 |

짧은 반복에서 DOM·리스너 증가가 없고 heap 증가는 약 0.9%였다. 장시간 누수 없음까지 입증한 것은 아니다. timer·object URL 전수 계측, 실제 OS 소프트 키보드, 서버 로그·실제 서명 쿠키와 다중 탭 경쟁, ZIP 내부 파일 비교는 이번 검증에 포함하지 않았다. 테스트 ZIP은 다운로드 확인 후 삭제하고 브라우저와 로컬 서버를 종료했다.

### 기존 타입 검사 실패

- `app/api/images/route.ts`: unknown/nullable 경로의 string narrowing 3건.
- `db/index.ts`: `cloudflare:workers` 선언 누락 1건.
- `worker/index.ts`: Fetcher/D1Database 타입 누락 2건.
- `vite.config.ts`: `.ts` import 허용 설정 1건.

이 문제를 숨기기 위해 타입 검사를 느슨하게 바꾸지 않았다. 별도 최소 수정과 검증 후, 동일 커밋의 Staging 실연결 로그인·저장·ZIP 검증을 수행해야 한다. 실제 데이터 생성·삭제·마이그레이션은 없었다.
