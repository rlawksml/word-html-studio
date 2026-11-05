# exact fallback 소스의 미래 필드 보존 요구 — FAIL

## 판정

**호환성 FAIL / 운영 롤백 NO-GO.** 실패를 검출했다는 이유로 보존 테스트 PASS로 바꾸지 않는다. 실제 DB/API·배포물·플랫폼 환경 검증은 아니다.

- 검증 브랜치 `codex/m1-exact-fallback-validation`
- probe exact `0a667c51aec024b5f220fbd743779a3dcc46e070`
- 원문 source `28efad2e9331b5e2951bf1d9b00cb553530130f7`
- 이 source는 2026-11-04 기록한 운영 저장 버전34의 메타데이터에 연결돼 있다. 이번에는 현재 활성 배포 여부를 다시 조회하지 않았고 불변 배포 artifact 자체를 실행하지 않았다.

## 원문과 실행 경계

원문3개를 수정 없이 `.ts.txt` fixture로 보관하고 byte/hash를 독립 대조했다.

| 원문 | SHA-256 |
|---|---|
| workspace-validation.ts | `b2e4b56c828a619c75f067ffb0936c935cd64eca8a6bec786db08044e1185ca4` |
| workspace-records.ts | `83ef4154f7e9d00937cd33a67e358ee3726e3267cc4ea871a20449cb10c2c9f3` |
| app/api/submissions/route.ts | `0f455779ab1f5fa0c2e85445b5d0928e5b113113bf3f13b412090a2b923bc831` |

해시를 검증한 validation 원문 한 개만 컨테이너 소유 scratch로 그대로 복사해 native TS stripping으로 import했다. type-only import는 지워지며 runtime import는 없다. route/records는 텍스트·해시·정적 경로만 확인한다. SDK·네트워크·환경파일·키·실제 사용자 자료·DB/Storage를 제공하지 않았다.

실행은 기존 source-policy의 무료 표준 Linux·network-none·비루트·RO source/도구·제한 scratch·cgroup/rlimit/출력 상한에서만 진행했다. 대상 모듈·테스트를 호스트에서 실행하거나 부족한 기능을 설치로 우회하지 않았다.

## 실제 결과

[run41994027553](https://github.com/rlawksml/word-html-studio/actions/runs/41994027553), job127132811139, exact0a667c5.

| TC | 기대 | 실제 |
|---|---|---|
| FALLBACK-EXACT-01 | 원문3해시/parse→sanitize→update 정적 경로 일치 | PASS |
| 02 | 알려진 값 정상 처리·호출 입력 불변 | PASS |
| 03 | 소식의 합성 미래 필드 보존 | FAIL |
| 04 | 사진의 합성 미래 필드 보존 | FAIL |
| 05 | 추가 항목의 합성 미래 필드 보존 | FAIL |
| 06 | 링크의 합성 미래 필드 보존 | FAIL |

실제6등록/PASS2/FAIL4, 취소·skip·todo0, 종료값1. preflight와 08:23:23.1636025Z 소유 컨테이너 정리 marker를 확인했다. 실패 index3/4/5/6은 네 보존 요구와 일치하며 timeout/상한/기동 실패를 호환성 실패로 부른 것이 아니다. 주 담당과 독립 검토자가 실제 원격 metadata/고정 숫자 로그를 대조했다.

03~06에서 보존 assertion이 먼저 실패하므로 뒤의 호출 입력 불변 assertion까지 실행됐다고 기록하지 않는다. 실제 정상 값 control02에서 확인한 입력 불변과 구분한다.

## 해석과 후속 게이트

정확한 과거 parser는 알려진 필드로 객체를 재구성해 합성 미래 필드를 반환하지 않았다. 해당 route 원문은 입력자 저장 경로에서 기존 raw JSON과 호환 병합 없이 parse 결과→sanitize→update로 이어진다. **이는 parser의 보존 FAIL과 소스 경로 근거이지 실제 DB에 저장한 후 데이터가 손상된 사건의 재현은 아니다.** 요청 validator가 임의 값을 그대로 허용하도록 고쳐 억지로 GREEN을 만들지 않는다. 필요한 통제는 신뢰할 수 있는 서버 기존 raw 데이터와의 호환 병합 및 실제 왕복 검증이다.

기존 수정 후보의 호환성 PASS를 이 원문/옛 배포물의 증거로 대체하지 않는다. 이 소스를 미래 데이터 보존 fallback으로 자동 승인하지 않으며, 별도 호환 안정 기준선·정확한 artifact·현재 스키마/기간/사진·환경 보존을 검증해야 한다. 새로운 안정 기준선을 실제 운영에 배포하는 단계도 사용자 별도 승인 대상이다.

이번 검증에서 기존 업무/QA·운영/보관 Staging·사진·서버 설정을 변경하지 않았다. 앱/DB 롤백·복원·main merge·배포·유료 전환을 실행하지 않았다. 앱 긴급 복귀에 과거 DB/사진 덮어쓰기를 넣지 않는다.
