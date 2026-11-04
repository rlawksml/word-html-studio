# #86 통합본 순서 저장 — 재현과 단계별 검증

## 현재 판정

**P1 재현 / 수정 진행 중 / 운영 NO-GO.** 실제 DB에 없는 합성 자료로만 검증했다. 운영/staging의 기존 업무·보관 QA 자료, 사진, 편집 임대는 조회·변경하지 않았다. 새 QA 책방2곳은 아직 승인되지 않았으므로 생성하지 않았다. SQL 적용·merge·배포도 하지 않는다.

기준: `codex/m1-digest-order-persistence`, 분기 기준 `cdf4be1`(롤백 문서-only 후속). Phase A는 `b4678f0`에 보존했다. 아래 최초 브라우저 결과는 수정 전 산출물의 재현이며, API 소스 추가 이후의 화면 수정 성공을 의미하지 않는다.

## 1. 브라우저 재현

`tests/browser-digest.mjs`와 `tests/helpers/built-ssr-fixture.mjs`를 사용했다. Playwright1.62.1/Chromium151.0.7922.34, Node26.11.1. 서버 listener·실제 HTTP API·Supabase SDK/키/환경파일 없이, 새 브라우저 프로필과 CDP의 고정 합성 origin/메모리 API만 사용했다. Node 측 fetch/http/net/tls 외부 연결도 차단한다.

기본 도구 sandbox에서 Chromium 권한 오류가 나 TC 시작 전에 중단된 첫 시도는 BLOCKED로 분류했다. 실행파일 누락이나 제품 결함으로 판단하지 않았다. 주 에이전트가 같은 합성 fixture만 범위 제한 권한으로 재실행했다.

실제 명령의 구조 (설치된 도구의 절대경로를 지정):

```sh
cd apps/web
env -i PATH=/usr/bin:/bin \
  PLAYWRIGHT_MODULE_PATH=/path/to/playwright/index.mjs \
  PLAYWRIGHT_BROWSERS_PATH=/path/to/installed-browsers \
  perl -e 'alarm 55; exec @ARGV' /path/to/node26 tests/browser-digest.mjs
```

새 build는 실행하지 않았으며 기존 산출물을 재사용했다. 따라서 현재 Git 소스 전체의 새 build 검증으로 표현하지 않는다.

- server `dist/server/index.js` SHA-256: `99b4dd57b49dda76787b7409d6737f19de2177c1fdfd43d1176d89a81ed780b2`
- client23파일: `rg --files -0 dist/client | xargs -0 shasum -a 256 | shasum -a 256` 방식의 목록 포함 지문 `d4fdaa700db0b95cbd0e5860cbe284530107844b6d1266ad05ae987723b13af7` (파일목록 순서에 의존하는 재현 기록, 범용 archive hash 아님)

| TC | 실제 결과 | 근거 |
|---|---|---|
| DIGEST-01 / TC-HTML-002 표시 | PASS | 현재 월 완료 책방2곳만 표시, 제목/지역 escape, 상세·다른월·초안 비포함 |
| DIGEST-02 / 포함 선택 저장 | PASS | 체크 변경의 submission PUT1회, 서버 snapshot 반영 및 새로고침 후 제외 유지 |
| DIGEST-03 / 순서 재접속 유지 | FAIL | 드래그 직후 순서 반전은 성공. 1,800ms 후 순서 저장 호출은 없고, 새로고침 뒤 GET 정렬로 원복 |

종료코드1. 정확한 실패 assertion: `bookstore drag order must survive server-owned GET/reload`. 전체 합성 쓰기1회는 체크박스 변경뿐이었다. 보호한 다른 월·draft 레코드 지문은 불변, 실제 DB 변경0.

### 증거 채널과 한계

| 채널 | 관찰/상태 |
|---|---|
| Console | console error0/pageerror0. warning 전용 수집·unhandled rejection 별도 채널은 미구현 |
| Network | 추적19요청 완료, timing0–14ms, transport/handler/외부연결시도/observer 오류0 |
| 완전성 공백 | CDP/mock 처리21건 중 page/fetch 관찰은19건. DELETE presence6건 대4건으로2건의 request ID 매칭 미확인 |
| 세션/복귀 | 합성 session GET·재진입 성공. 실제 쿠키/서명/서버 인증 검증 아님 |
| 서버 | 메모리 mock handler만. 실제 Worker/API/DB 로그 SKIPPED |
| 메모리/장기자원 | SKIPPED — 반복/GC/retaining path 계측 없음. fresh context 종료만 수행 |

두 reload에서 이전 문서의 collect 이후 발생하는 pagehide/effect cleanup의 keepalive DELETE가 관찰 계층 차이를 만들었을 가능성이 크다(`use-editing-presence.ts`, `releaseEditingPresence`). 소스와 횟수의 정합성만 확인했고 개별 ID를 매칭하지 않았으므로 확정 원인으로 기록하지 않는다. **전체21건의 transport가 완료됐다고 주장하지 않는다.** 이 계측 공백은 순서 저장 호출0/화면 즉시 반영/새로고침 원복의 제품 결함 증거와 분리한다.

## 2. 원인과 안전 설계

- `reorderDigest`는 submissions 배열만 바꾼다.
- 일반 persistence는 레코드 내용의 fingerprint로 저장 대상을 정하므로 배열 순서만 바뀌면 저장하지 않는다.
- workspace GET은 `updated_at`으로 정렬한다. 전역 `Bookstore.sortOrder`를 바꾸거나 소식 `updated_at`을 조작하는 우회는 다른 월/원문에 영향을 준다.

독립 safety architect는 source-only 단계 구현 GO/SQL 적용·배포 NO-GO를 제시했다. 월별 독립 순서 테이블·별도 component marker와 전용 GET/PUT+hook으로 분리하며 기존 Workspace GET/초기 로더/소식 JSON/기간/사진은 변경하지 않는다. RPC에서 digest lease 소유·HTML 역할·유효기간과 revision CAS를 한 트랜잭션으로 확인한다. UI의 현재 advisory presence만 신뢰하지 않는다.

marker 미설치만 명시적 available:false이며 네트워크/권한/설치 불일치를 미설치로 숨기지 않는다. 백업은 새 marker를 확인한 경우에만 새 테이블을 선택해 기존 DB의 백업을 깨뜨리지 않아야 한다. 실제 SQL 적용·추가 QA 생성은 별도 승인 전까지 하지 않는다.

## 3. Phase A — 순수 정책

- `lib/digest-order.ts`(178줄), `tests/digest-order.test.mjs`(200줄)
- DTO500개 한도·양수 유일 안전정수/월/revision/ISO 검증, 초기 sentinel 구분
- 불변 projection/드래그, 다른월·draft·누락 ID를 읽기 과정에서 삭제하지 않음
- 신규 완료 자료의 결정적 ID순 append, 재완료 시 저장 위치 복귀
- 응답 유실 confirmed/conflict/unknown 구분, 월/epoch가 바뀐 늦은 응답 배제

주 에이전트와 작성자가 다음 순수 단위를 각각 실행해 **등록18TC/18PASS/0FAIL/0SKIP**을 확인했다.

```sh
env -i PATH=/usr/bin:/bin /path/to/node26 --test tests/digest-order.test.mjs
```

독립 QA도 원문/fixture를 검토하고18/18을 재확인했다. 추가 탐색 조합은 등록 TC 숫자와 합산하지 않는다. 새 모듈 한정 strict TypeScript 검사는 작성자 PASS 보고이며 전체 앱 typecheck/build 결과는 아직 아니다. API/RPC/실제 PostgreSQL/화면 연결의 완료 근거로 삼지 않는다.

## 4. Phase B — 전용 API·저장소와 SQL 준비

작성자·주 에이전트·독립 QA가 아래 5개 파일의 등록 **67/67 PASS**, 실패/취소/제외0을 확인했다. Phase A18 + API18 + repository15 + backup5 + SQL 소스 계약4 + 기존 compatibility7이다. 전체 프로젝트 TypeScript와 migration 정책은 작성자와 주 에이전트가 PASS를 확인했다. 독립 QA는 tsc를 중복 실행하지 않았으며 실제 SQL·서명 인증·복원 성공과 구분했다.

```sh
env -i PATH=/usr/bin:/bin /path/to/node26 --test \
  tests/digest-order.test.mjs tests/digest-order-service.test.mjs \
  tests/digest-order-repository.test.mjs tests/digest-order-backup.test.mjs \
  tests/schema-compatibility.test.mjs
env -i PATH=/usr/bin:/bin /path/to/node26 node_modules/typescript/bin/tsc --noEmit --incremental false
env -i PATH=/usr/bin:/bin /path/to/node26 scripts/migration-policy.mjs
```

- thin route → 기존 서명 세션 확인 → HTML 역할 → 전용 repository/RPC port로 분리했다. 미인증401/다른 역할403은 본문·fingerprint·DB 생성 전에 종료한다.
- 요청은 query 월/JSON 필드·중복 ID·64KiB 실제 본문 상한을 검증한다. 성공 응답도 요청 IDs 완전 일치와 revision 정확+1을 확인하고, 증가 불가능한 MAX_SAFE 요청은 쓰기 전에400으로 거부한다.
- RPC 성공이 불명확하거나 저장소가 실패하면 고정503을 반환한다. 내부 SQL·원문 provider 오류·세션 hash를 노출하거나 RPC를 무조건 재시도하지 않는다. 충돌409는 검증된 같은 월 최신 값만 전달하고, lease423·미설치·설치 불일치를 구분한다.
- SQL은 별도 `digest_order` component·table만 추가한다. digest lease의 row lock/HTML role/hash/유효기간과 revision CAS를 묶고 기존 submissions/bookstores/사진을 수정하지 않는다.
- 독립 QA가 잠금 이후 ID 존재 검사의 경쟁 가능성을 소스에서 지적했다. `GET DIAGNOSTICS ... ROW_COUNT`가 전체 요청 수와 같은지 월 검사·CAS 전에 확인하도록 보완했다. 실제 PostgreSQL로 race를 재현한 증거는 아니다.
- 신규 SQL SHA-256: `7df2e4514ee83539866cb43ddb3485f3c11d194b6d512e9ea98e30bc0442b7b2`. 기존 migration hash는 변경하지 않았다.
- 백업은 독립 component 설치가 확인된 경우에만 새 table을 포함하고, 기존 boolean 호출과 구 manifest의 table 목록은 유지한다. 정확한 marker 부재만 미설치로 처리하고 권한/네트워크 오류를 숨기지 않는다.

**한계:** HTTP factory는 메모리 port, repository는 fake SDK, SQL은 정적 계약 검사다. 실제 Next/Worker 인증·서명 cookie·Postgres 권한/lock/CAS·DB/Storage·백업 실행/복원·화면 연결을 검증한 것은 아니다. 신규 SQL은 작성만 했고 실행하지 않았다.

### 실제 복원은 별도 BLOCKED

`planTableRestore`는 비어 있지 않은 대상에 기본 거부하고 `--resume`도 전체 행/hash 일치를 요구한다. 사전 migration의 `app_schema_versions.applied_at` 차이 또는 추가 marker 때문에 복원이 거부될 수 있다. backup 목록 선택 테스트를 복원 성공으로 보고하지 않는다. 원본 백업을 변형하지 않는 marker reconciliation과 승인된 별도 격리 대상의 실제 복원 검증이 필요하다. 현재 staging 초기화로 우회하지 않는다. [#47 기록](https://github.com/rlawksml/word-html-studio/issues/47#issuecomment-6633286072).

## 5. 남은 검증

| 단계 | 상태 | 조건 |
|---|---|---|
| Phase B 전용 API/RPC·component·백업 | source/mock67 PASS | 독립 QA 재확인. 실제 SQL·서명 인증·복원 검증 아님 |
| Phase C hook/UI 연결 | 진행 중 | B 검증 뒤 연결, 새 build의 DIGEST01~03 재실행 필요 |
| 실제 PostgreSQL·동시 CAS·임대 만료 | BLOCKED | 새 SQL과 명확한 신규 테스트 범위 승인 필요 |
| 실제 staging 통합본/사진/두 작업자 | BLOCKED | 기존 자료를 사용하지 않는 신규 QA 승인 필요 |
| 전체 회귀·운영 판정 | NO-GO | 필수 P0/의존성 #87/exact fallback·최신 백업/환경 보존 미완료 |

한 이슈 안에서도 정책→API→UI를 차례로 검증하고, 완료하지 않은 항목을 통과로 표시하지 않는다. 현재 #86을 닫거나 운영에 반영하지 않는다.
