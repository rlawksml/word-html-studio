# 인증 후 정적 파일 404 수정 검증

## 판정 / 대상

- 날짜: 2026-09-29. PRE-DEPLOY, 로컬 수정 검증 PASS / 원격 배포 **NO-GO**.
- 브랜치: `codex/m1-staging-access-gate`, 기준 `e331af7` 이후 이 보고서와 함께 커밋한 변경. PR #81, Issue #77.
- 환경: Node 24.16.0, Miniflare 5.20260907.0-alpha/workerd, 합성 gate 암호와 세션키. 실제 Supabase 설정 없음.
- 운영 데이터 변경 없음. 원격 배포·머지·유료 서비스 가입 없음.

## 원인과 수정

`run_worker_first: true`가 인증 우회를 막지만, 인증 이후 생성 JS/CSS도 앱 라우터로 전달돼 실제 존재하는 파일이 404였다. gate 단위 테스트의 mock upstream만으로는 파일 제공 성공을 증명하지 못했다.

gate를 최외곽에 유지하고 `/assets/` GET·HEAD에만 ASSETS adapter를 삽입했다. 다른 경로·메서드는 기존 앱에 전달한다. ASSETS 404는 body 취소 후 앱 fallback, 기타 상태는 보존, binding 오류는 generic 503이다. 기존 운영 Worker, Vite, DB 스키마는 변경하지 않았다.

## TC 결과

| TC/검증 묶음 | 결과 | 증거 |
|---|---|---|
| CF-STAGE 4개 | PASS | 환경 분리·모듈 구성·CI 명령 연결 |
| STAGE-GATE 14개 | PASS | 기존 인증·Origin·쿠키·오류·경로 경계 |
| STAGE-ASSET 7개 | PASS | 정적 전달·404 fallback·오류·인증 우회 차단·쿠키 제거 |
| STAGE-RUNTIME 8개 하위+parent | PASS | 실제 엔진 로그인, JS/CSS bytes·MIME·GET/HEAD, favicon/PDF, POST, API, 쿠키, logout, native limiter |
| 기존 npm test 82개 | PASS | 빌드 및 앱 회귀 |
| lint/typecheck/dry-run/diff-check | PASS | 22개 부속 모듈에 신규 adapter 포함, gzip 887.85 KiB |
| 원격 Worker·Supabase 전체 P0 | BLOCKED | 미배포·실제 테스트 연결 미설정 |
| 실제 브라우저 Console/Network/메모리 | SKIPPED | 이번은 Worker/API 격리 검증, 브라우저 검증 별도 필요 |

`test:staging-worker`의 Node 집계 34/34(런타임 parent 1개 포함), FAIL 0. 기존 회귀 82/82는 별도다. 위 마지막 두 묶음 때문에 전체 릴리스 승인은 하지 않는다.

## 재현·실행 증거

- 수정 전: 인증 후 `/assets/EditingPresenceNotice-BMkR4Fx-.js` 기대 200, 실제 404. [Issue 기록](https://github.com/rlawksml/word-html-studio/issues/77#issuecomment-5888891150).
- 수정 후: 해당 JS 200, `text/javascript`, 1036 bytes. 대표 CSS 및 JS 원본 bytes 비교도 통과.
- 별도 root 확인: favicon 200/712 bytes, 가이드 PDF 200/553195 bytes, 메인 200/HTML, robots 200/text. 외부 요청 0.
- 인증된 `/api/version`은 의도적으로 DB를 주입하지 않아 503이며 정확한 `버전 확인에 필요한 저장소 연결 정보가 없습니다.` 본문을 검증한다. DB 장애 해결 또는 DB 연동 성공으로 해석하지 않는다.
- 최초 테스트 도구의 Miniflare v5 설정/loopback 권한 문제와 서비스 결함을 구분했다. v4 호환 변환 API, has_user_worker 설정 및 로컬 listen 권한으로 도구 문제를 해결했으며 애플리케이션 접근 보호는 약화하지 않았다.

명령: `npm test`, `npm run test:staging-worker`, `npm run lint`, `npm run typecheck`, `npx wrangler deploy --dry-run --config wrangler.staging.json`, `git diff --check`.

## 데이터·리소스 안전과 남은 작업

- 테스트는 env 파일을 로드하지 않고 합성 binding만 주입한다. 외부 fetch는 차단하고 최종 outbound counter 0을 확인한다.
- DB 행·Storage 사진·편집 잠금 생성 0. 정리 대상 없음. Miniflare는 finally에서 dispose하며 응답 body를 소비한다.
- 실엔진 단기 종료 검증은 장시간 브라우저 메모리 누수 검증을 대신하지 않는다.
- CI/표준 검증에서 assets 단위 및 실엔진 검증을 누락하던 리뷰 지적을 수정하고 설정 TC로 연결도 고정했다.
- 다음: 원격 배포 전 무료 플랜 제한·secret·공개 이미지 경계 확인, 별도 승인 범위의 staging 배포 및 브라우저/Supabase 전체 P0. 운영 merge 없음.
