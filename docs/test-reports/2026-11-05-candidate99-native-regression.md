# 후보 브랜치 native 회귀 99TC

## 판정과 대상

- 2026-11-05 PRE-DEPLOY, 소스 정책 범위 GO / 전체 운영 NO-GO.
- exact SHA: `24279e7266d9ca522a8920e4b9e5d1850ec583f6`.
- branch: `codex/m1-preprod-candidate`, 제품 `1.1.0-rc.1`.
- 운영·보관 Staging과 분리된 공개 저장소의 무료 표준 GitHub Linux runner에서 실행했다.
- 주 에이전트와 독립 검토자는 각 run metadata·실제 PASS marker·marker 생성 전 TAP/격리 검사 조건을 대조했다. 단순 workflow 녹색만을 성공 근거로 쓰지 않았다.

## 병렬 실행 결과

| 경계 / 관련 이슈 | 실행 | job | 등록/성공 | 실패/취소/outer skip/todo |
|---|---|---:|---:|---|
| marker 복원 정책 / #47 | [41980940194](https://github.com/rlawksml/word-html-studio/actions/runs/41980940194) | 127090734468 | 25/25 | 모두0 |
| 사진 보존 / #88 | [41980939649](https://github.com/rlawksml/word-html-studio/actions/runs/41980939649) | 127090677600 | 12/12 | 모두0 |
| gate·legacy 통합/정리 차단 | [41980939958](https://github.com/rlawksml/word-html-studio/actions/runs/41980939958) | 127090667824 | 30/30 | 모두0 |
| ledger·응답 관찰 증거 도구 | [41980941534](https://github.com/rlawksml/word-html-studio/actions/runs/41980941534) | 127090669141 | 17/17 | 모두0 |
| 빈 발행 월 정책·소스 연결 / #91 | [41980942956](https://github.com/rlawksml/word-html-studio/actions/runs/41980942956) | 127090682605 | 15/15 | 모두0 |

**이번 후보의 5회 실행만 합쳐 99PASS / 실패0 / 취소0 / outer skip0 / todo0.** 이전67/17/15 결과와 중복 합산하지 않는다. 보호 검증 안에서 실행하는 legacy 자식3건의 의도적 skip은 실제 통합 성공이나99개의 outer TC에 추가하지 않는다.

실제 PASS marker 시각(UTC)은 restore06:31:36.986, photo06:31:27.845, preservation06:31:27.407, evidence06:31:29.230, publication06:31:30.065다. 모두 위 exact SHA와 suite/등록수/실패0/skip0가 일치했다.

## 실행·데이터 경계

- 검토된 `.github/validation/source-policy-launcher.mjs` SHA-256은 `463dd25ddacb738cf75d7fcb2446374b3180a4960d99a4e89e3dc48f1ec5eeaf`다. workflow pin과 일치한다.
- 고정 suite allowlist만 FROM scratch 안에서 실행했다. 무키·외부 네트워크 차단·비root·RO 입력과 실효 cgroup/rlimit·scratch/출력 상한의 사전검사를 통과해야 TC를 시작한다.
- 각 run의 guard/source job은 성공했고 일반 verify·Supabase·rollback/offline 앱 job은 SKIPPED였다. 일반 앱 설치·실DB 통합을 이 결과로 대신하지 않는다.
- restore는 순수 정책·소스 계약·메모리 port 검증이며 실제 Postgres/Storage 복원이 아니다. 사진도 fake transport/ledger·소스 경계이며 실제 Storage 삭제/업로드 성공을 증명하지 않는다.
- evidence17에는 SDK adapter12가 포함되지 않는다. #91의 실제 mounted UI·한글 입력·부분 월 편집·Network/heap 검증은 별도 대기다.
- 운영·보관 Staging의 DB/Storage·기존 업무/QA 행·사진·환경·배포를 변경하지 않았다. 테스트 seed·초기화·정리·유료 전환·main merge도 없다.

## 전체 앱 검증과 구분

다른 브랜치 `codex/m1-offline-app-validation`의 기존 lock baseline 검증은 별도다. run41980736350/exact `c98a680a51c46ec20385c4a741aa7f69067324e7`에서는 무스크립트 설치와 offline 인계 뒤 TYPECHECK exit2가 관측됐다. 안전한 진단은 TS2307 / `vite.config.ts:3:27`이며, 필수 공개 Git 빌드 metadata를 제외한 검증기 입력 문제를 보완했다. 원시 오류문이나 프로젝트 식별자는 공개하지 않는다.

후속 runner 보완은 이99개를 새 commit의 전체 앱 성공으로 승격하지 않는다. 후보의26파일246개는 정적 예상수이며 실제 unit PASS가 아니다. lint/build/unit·브라우저·실제 편집 임대/저장/사진·#87 audit·복원·exact fallback/최신 독립 백업은 아직 남아 있다.

## 재현·추적

검토된 수동 CI만 사용한다. 호스트에서 임의 npm/SDK 테스트를 실행하라는 안내가 아니다.

```text
workflow: ci.yml
ref: codex/m1-preprod-candidate
validation_mode: source_policy
source_suite: restore | photo | preservation | evidence | publication
expected_commit: 24279e7266d9ca522a8920e4b9e5d1850ec583f6
```

새 HEAD에서 재검증하려면 그 exact SHA와 관련 source/launcher 경계를 다시 확인해야 한다. 이 보고서는 검증한 commit을 고정한 과거 증거이며 이후 commit에 자동 적용되지 않는다. 이슈를 닫거나 운영 GO·실제 긴급 롤백 가능으로 표시하지 않는다.
