# 스테이징 입장 보호 검증

- 브랜치: codex/m1-staging-access-gate; 기준 e9d48b4 + 이 PR 변경
- 로컬 테스트만. 운영 데이터 변경 없음, DB/network 테스트 데이터 생성 없음.
- 기존 Sites worker/Vite와 역할별 인증은 변경하지 않았다.

## TC 결과

각 STAGE-GATE TC의 사전조건은 HTTPS 가상 요청, 합성 암호/서명키, 메모리 limiter 및 next.fetch spy다. 실행 단계와 기대값은 `apps/web/tests/staging-gate.test.mjs`의 같은 번호 테스트에 있다. 실제 비밀키를 사용하지 않는다.

| TC | 검증 | 결과 |
|---|---|---|
| STAGE-GATE-01~04 | 설정 fail-closed, 로그인 페이지, 정상/실패 로그인 | PASS |
| STAGE-GATE-05~07 | limiter 누락/거부/예외, Origin, content type/필드/본문 2048 bytes | PASS |
| STAGE-GATE-08~09 | 서명 변조/중복 쿠키/host replay, 정확한 8h 만료 | PASS |
| STAGE-GATE-10~12 | 인증 후 전달, 로그아웃, API/static/upgrade 우회 차단 | PASS |
| STAGE-GATE-13~14 | 복수 쿠키/응답/예외 보존, 이미지 변환 경로404 | PASS |
| CF-STAGE-01~04 | 대상·DB·빌드·CI 연결 설정 | PASS |
| 기존 npm test 회귀 | 82/82 | PASS |
| lint/typecheck/build/dry-run | 로컬 검사 | PASS |
| 실제 Worker/브라우저 및 Supabase P0 통합 | 비밀키/공개경로 미설정, 미배포 | BLOCKED |

인증 전용 14/14, 설정 4/4, 기존 회귀 82/82는 별도 실행 결과다. 실제 배포 완료로 해석하지 않는다.

## 발견 및 수정

1. 인증 없는 WebSocket Upgrade 요청이 HTML Accept일 때303으로 분류됨. 인증 우회는 아니나 기대401과 달라 수정 후 TC12 통과.
2. base_dir를 앱 루트로 지정하자 Wrangler 기본 Text/Wasm 규칙이 개발 파일/SQL까지 포함함. 각 기본 규칙을 dist/server 범위로 덮어쓰고 dry-run의 21개 부속 모듈+진입점을 확인. 불필요 파일 업로드는 실행되지 않았다.
3. 로컬 check 명령에도 gate 테스트를 넣어 CI와 수동 검증 모두 실행하도록 보완.

## 남은 위험 / 판정

순수 handler 및 로컬 패키징 통과. 실제 배포 **NO-GO**, merge 금지.
Workers 계정 Free 플랜은 대시보드에서 확인했으나 native limiter 실제 Free 지원/한도와 CPU 성능은 배포 전 확인해야 한다.
설정 파일에 secret 없음; 실제 등록/키 생성/공개 경로 활성화 미실행.
서명 쿠키는 8h로 브라우저 종료 보장 없음. 로그아웃은 브라우저 쿠키 삭제이며 탈취 토큰 개별 서버 폐기는 미지원(서명키 교체로 전체 무효화).
Supabase 공개 미리보기 URL은 gate 범위 밖이다. 실제 이미지 권한 검증 전 외부 테스트 허용 금지.
기존 빌드의 큰 client chunk/import 확장자 경고는 유지한다.

## 명령

`npm test`, `npm run check:cloudflare-staging`, `npm run lint`, `npm run typecheck`, `git diff --check`.
패키지 closure 확인: `wrangler deploy --dry-run --config wrangler.staging.json --outdir /private/tmp/bookstore-gate-dryrun-scoped`.
