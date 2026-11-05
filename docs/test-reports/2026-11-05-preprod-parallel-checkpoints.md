# 운영 전 병렬 체크포인트 — 2026-11-05

## 현재 판정

**운영 NO-GO.** 이 브랜치는 source 보존·개별 테스트 체크포인트이며 운영 배포 후보가 아니다. main merge·배포·실제 SQL·DB/Storage·환경·과금 변경은 하지 않았다. 보관 QA·기존 업무 자료도 수정하지 않았다.

원래 작업 폴더의 HEAD0951802와 tracked/untracked 36개를 그대로 보존했다. Git bundle·patch·untracked archive를 원래 저장소의 비공개 로컬 `.git/codex-checkpoints/2026-11-05-preprod-0951802/`에도 보관해 임시 폴더 정리에 대비했다. 세 hash 재대조와 bundle verify는 PASS지만 별도 장치/DB 백업은 아니다. 별도 worktree에서 복원 정책·사진 보존·기존 안전 코드 보존을 분리했다. 주 에이전트만 Git/수동 CI/이슈 쓰기를 담당하고, 구현·독립 리뷰·증거 확인은 병렬로 수행했다.

## 개별 검증 증거

| 체크포인트 | 검증한 exact 코드 | 실제 실행 결과 | 한계 |
|---|---|---|---|
| #47 marker 복원 정책 | `084ee1a09ec740986d5d0b7e660e081148ba7893` | [run41967318589](https://github.com/rlawksml/word-html-studio/actions/runs/41967318589) 25PASS | 순수 정책·메모리 insert loop·소스 계약. 실제 복원 아님 |
| #88 사진 보존 방어 | `e0219f9ab38280cf8cd0678008817abeedb6c509` | [run41968357231](https://github.com/rlawksml/word-html-studio/actions/runs/41968357231) 12PASS | client fake transport·순수·구조. React/실Storage 경합 아님 |
| 기존 gate·실연결 테스트 차단 보존 | `3ccb429bd1cab639294657c48c24aefd63bab625` | [run41969588551](https://github.com/rlawksml/word-html-studio/actions/runs/41969588551) 30PASS | gate14 + cleanup mock10 + loader/진입 차단6. 실제 서버/브라우저 아님 |

각 run은 독립 검토자가 실제 metadata와 성공 로그를 확인했다. 이전 #86의177/브라우저7, 다른 날짜의87/100/118/129 결과를 이 브랜치 전체 회귀로 재사용하지 않는다.

### 합본 exact SHA 병렬 재검증 — 67PASS

검증 커밋 **`3ccb429bd1cab639294657c48c24aefd63bab625`**. 다음 세 run을 병렬 실행했고 모두 success다.

| suite | 실제 실행 | 등록/성공 | fail/cancelled/skipped/todo |
|---|---|---|---|
| restore | [41969588641](https://github.com/rlawksml/word-html-studio/actions/runs/41969588641) | 25/25 | 모두0 |
| photo | [41969589002](https://github.com/rlawksml/word-html-studio/actions/runs/41969589002) | 12/12 | 모두0 |
| preservation | [41969588551](https://github.com/rlawksml/word-html-studio/actions/runs/41969588551) | 30/30 | 모두0 |

각 실제 로그의 source-policy PASS·동일 SHA를 주 에이전트와 독립 검토자가 확인했다. 세 guard/source job은 성공하고 일반 verify·Supabase·rollback job은 skip했다. 67개만 합산하며 앞의 개별 run25/12는 중복이다. hardblock의 자식에서 의도적으로 skip한 legacy3건은 이67개에 포함하지 않으며 실제 통합3건을 실행한 것이 아니다. cleanup10은 메모리 검증이지 실제 ownership·원자성·TOCTOU/삭제 안전성 증거가 아니다.

전체 앱 type/lint/build·브라우저/Miniflare·실제 DB·복원·fallback·자원 누수 검증은 미실행/BLOCKED다. `security-audit` guidance의 신규 의존성 설치 금지와 OS 격리 조건에 따라 없는 toolchain을 설치하거나 실행 조건을 완화하지 않았다. 소스 검증 범위 GO이며 운영은 NO-GO다. 보고서-only 후속 커밋은 위 실제 검증 SHA와 구분한다.

## 왜 기존 미커밋 안전 코드를 먼저 보존했나

0951802에는 실제 staging의 native form `Origin: null` 오류를 막은 GET 폼 `Referrer-Policy: same-origin` 변경이 없었다. 또한 CI job 차단과 별개인 로컬 legacy integration hardblock도 빠져 있었다. 그 상태의 Git HEAD만으로 새 배포물을 만들면 이미 확인한 수정이 퇴행하거나 위험한 정리 경로가 다시 노출될 수 있어 다음을 먼저 모았다.

- gate 변경·단위/Worker/native form 테스트4파일
- legacy local runner·top-level hardblock·SDK 동적 import·mock-only cleanup 정책과 TC6파일
- package script는 위 두 경계만 추가 병합. 사진/digest 목록과 의존성 버전은 덮어쓰지 않았다.
- 원본과 같은8파일은 hash 비교했다. integration-safety child의 scratch 환경·64KiB 출력 한도만 보강하고 legacy 상단 병합에서 #88 `200/retained` 응답 계약을 유지했다.

기존 526줄 gate test와 528줄 legacy test는 보존 정확성을 위해 이번에는 분리하지 않았다. 새 정책·runner는 책임별 파일과 500줄 이하를 유지했다.

## 아직 원래 dirty 폴더에만 남은 자료

- retain-only mock Stage2의 ledger/SDK mock/adapter/TC5파일
- HTML-copy browser/fixture observer/단위TC3파일
- 당시 실제 UAT·역할·줄바꿈·실패/재시도 증거와 합성 캡처
- 이 자료들을 설명하는 과거 README/TODO/Setup/TC 요약 일부

삭제·일괄 커밋하지 않았다. 이후 경계별 검토와 공개 범위 정리 후 보존한다. 과거 QA ID/Storage prefix·로컬 경로는 필요한 근거만 남기며 사용자 원문·실사진·ZIP·환경파일/비밀값은 공개하지 않는다. 이 브랜치를 그 미커밋 변경 전체의 대체물로 사용하지 않는다.

## 다음 순서와 승인 경계

1. 완료: 합본 exact SHA의 restore25/photo12/preservation30 병렬 재확인·독립 증거 대조. 결과를 각 이슈에 연결.
2. 남은 Stage2/HTML-copy·과거 증거를 경계별 보존하고 문서 최신 상태와 역사 기록 분리.
3. #87 Next와 #66 vinext는 별도 의존성 변경으로 검증. 공식 최신 후보를 기록했지만 새 package 설치·lock 변경·audit 재실행은 하지 않았다. 보안 실행 조건을 갖춘 준비된 toolchain이 필요하다.
4. #91 빈 월의 실제 UI 재현·수정·검증, 같은 후보 커밋의 전체 type/lint/build/browser 회귀.
5. 별도 승인 후 #86 추가형 SQL과 신규 QA·두 작업자·사진·대용량/HEIC·응답유실 실제 통합 검증. 기존 자료를 실패 주입/삭제 대상으로 사용하지 않음.
6. #47 복원은 현재 운영/보관 Staging이 아닌 승인된 새 빈 환경에서만 검증. 최신 일관성 있는 독립 백업, count/hash/사진 참조·권한 확인.
7. #46/#48의 정확한 fallback 불변 배포물·미래 JSON/기간/사진 호환·현재 환경 보존을 확인하고 최종 운영 승인 요청.

무료 범위를 넘어서는 서비스 전환이나 지출은 하지 않는다. 앱 롤백은 최신 DB/사진을 유지하며 검증한 앱 배포물만 바꾸는 절차다. 운영 DB를 예전 백업으로 덮어쓰거나 현재 Staging을 초기화하는 명령은 포함하지 않는다.
