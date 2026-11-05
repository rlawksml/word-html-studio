# 운영 전 보존 소스 후속 검증

## 판정

- 결과: **NO-GO (운영)** / evidence 순수17TC 범위 GO
- 단계: PRE-DEPLOY, 2026-11-05
- 검증자: 주 에이전트 실행·로그 확인, 독립 검토자 소스/원격 증거 대조
- 데이터: 운영·보관 Staging·사진·편집 임대 변경 없음

## 대상과 변경

- 기준: `b5318a2`, 후속 브랜치 `codex/m1-preprod-source-completion`
- 검증한 exact 코드: `16b7558abf118d2b41ad8b7bf924d108639f0800`
- 배포: 없음. 운영/staging URL을 이번에 점검한 것이 아님
- 원래 미커밋 Stage2·HTML 복사 도구8파일을 보존했고 원본과8/8 SHA-256 일치. package는 해당 기본 테스트3개·browser 명령1개만 추가해 현재 dependency·사진·digest 항목을 유지했다.
- raw 보고서11개와 PNG는 비공개 보존하고 [역사 색인](2026-11-05-historical-evidence-index.md)에 요약·해시만 남겼다. 당시 source/dist·ZIP·감사 manifest까지 보관됐다는 뜻은 아니다.

## 변경 기능과 TC

| 범위 | 자동화/기대 | 상태 |
|---|---|---|
| ledger6 | `test-owned-ledger.test.mjs`: 불변 receipt, 생성/수정 불확실성 전이, 미래 JSON·지원 대상 검사 | PASS6 |
| observer11 | `fixture-response-observer.test.mjs`: Promise/Response 유지, 정확한 합성 origin/API, 실패 전파·1MiB 상한 | PASS11 |
| SDK adapter12 | 설치 SDK+mock fetch의 pagination/CAS/응답유실 | 이번 profile 제외, 미실행 |
| HTML browser5 | built UI·메모리 clipboard·새 문서·ZIP·합성 로그아웃 | 이번 profile 제외, 미실행 |

실행된 등록 TC 집계는 **PASS17 / FAIL0 / cancelled0 / skipped0 / todo0**다. SDK12·browser5는 이 집계 밖의 미실행 항목이며 과거18/118/129나 이전 합본67을 이번 exact SHA의 결과에 더하지 않는다.

## 실제 실행 증거

[run41971940363](https://github.com/rlawksml/word-html-studio/actions/runs/41971940363), exact `16b7558abf118d2b41ad8b7bf924d108639f0800`, 2026-11-05 05:07:27Z 완료, success.

실제 로그: `Source policy validation PASS: suite=evidence tests=17 failures=0 skips=0 commit=16b7558abf118d2b41ad8b7bf924d108639f0800`.

guard/source job 성공. 일반 app verify·실Supabase·rollback job은 skip. 독립 검토자가 metadata와 실제 로그를 직접 확인했다. 허용4파일/정확2argv와 검토한 launcher hash를 고정하고 OS preflight 통과 뒤 실행했다. npm·SDK·설치·실제 HTTP·브라우저·파일 쓰기는 이17TC에 없다.

```text
node --test --test-reporter=tap --test-isolation=none
  tests/test-owned-ledger.test.mjs
  tests/fixture-response-observer.test.mjs
```

실제 실행은 위 명령을 무키·무네트워크·RO root·비root·memory256MiB/swap0/CPU1/PID32/scratch16MiB·CPU30초/wall45초/출력64KiB 경계 안에서 수행했다. 호스트에서 저장소 테스트를 실행하거나 원시 TAP/생성물을 artifact로 게시하지 않았다. `git diff --check`는 별도 PASS다.

## 증거 한계·데이터 정리

- ledger는 caller 제공 receipt의 순수 일관성 모델이지 실제 DB 소유권·원자성 증거가 아니다.
- observer는 합성 응답의 제한된 clone 관찰자다. OS 네트워크 차단 장치나 실제 무계측 응답 수명·메모리 누수 검증이 아니다.
- Console/Network·서버 로그·세션 복구·heap/DOM/listener의 실제 앱 반복 검증은 이번 실행에 없다.
- 새 DB 행·Storage 객체·presence를 만들지 않았으므로 정리도 하지 않았다. 성공 QA 자료는 그대로 보관한다.
- 전체 type/lint/build·SDK12·브라우저5·실DB·fallback은 아직 미검증이다. 과거 보고서는 현재 통과 증거로 승격하지 않는다.

## 사용자 승인된 다음 실행 환경

사용자가 무료 GitHub Linux에서 테스트 의존성을 준비하는 단계만 허용했다. 설치 스크립트·운영 비밀값·DB 없이 준비하고, 실제 앱 실행은 이후 네트워크 차단·RO toolchain·자원 제한 환경에서만 진행한다. 이는 package 설치에 한정된 예외이며 운영 배포·유료 전환·실제 SQL/QA 쓰기 승인이 아니다. baseline 준비/전체 앱 검증 경로는 별도 구현·리뷰 중이고 아직 실행 완료로 표시하지 않는다.

#87은 Next `16.3.4→16.4.5`의 **semver minor** 후보와 실제 lock closure를 검증해야 한다. #66 vinext/React major 호환 전환과 분리하며, 수작업 lock 수정·`--force`·audit gate 완화는 하지 않는다. 후보 설치본이 준비되지 않은 상태에서 보안 업데이트 성공을 주장하지 않는다.

최종 판정: 소스 보존/evidence17 체크포인트만 완료. 전체 P0·#91 UI·#86 승인된 실제 SQL/QA·새 빈 복원 대상·최신 백업·exact fallback 확인 전에는 운영 NO-GO.
