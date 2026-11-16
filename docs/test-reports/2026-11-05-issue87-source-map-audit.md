# #87 source-map-js 수정 후 실제 재audit

## 판정

**이번 production metadata audit PASS / 전체 운영 NO-GO.** 이전 lock의 high1과 전송 승인 차단 이력은 보존하고, 이번 사용자 명시 승인 후 실제 결과로만 갱신한다. 알려진 의존성 권고 검사이며 전체 앱 보안 감사·실제 배포 검증은 아니다.

- 실제 실행: [42032239269 / job127261368232](https://github.com/rlawksml/word-html-studio/actions/runs/42032239269/job/127261368232), 수동 dispatch·attempt1.
- 정확한 audit source: `3fdb1d1b4159484c45182e77a285d5f827ef5d5e`, branch `codex/m1-source-map-audit`.
- npm `11.19.1`, outcome `PASS`, reason `NONE`.
- info0 / low0 / moderate0 / **high0 / critical0 / total0**, advisoryIds/sourceIds 모두 빈 배열.
- audit 단계와 guard/job 성공. 무관 verify·Supabase·source-policy·rollback·offline-app job은 SKIPPED이며 TC 성공 수가 아니다.
- 원시 audit JSON/log를 출력·보관하지 않았고 artifact는0개다.
- main merge·PR 생성·Staging/운영 배포·SQL·기존 DB/Storage/사진/QA·환경/유료 설정 변경 없음.

## 승인과 이전 차단

앞선 시도는 두JSON artifact 전달 승인만으로 audit 전송 범위를 확대하지 않고 실행 전에 차단했다. 사용자가 이후 **공개 package/lock graph와 Node/npm 버전·OS/CPU 아키텍처를 공식 npm registry에 전송하는 무료 격리 plain audit**를 명시적으로 허용했다. 그 답변 확인 후에만1회 dispatch했다. 앱 소스·키·DB·사진 전송, 설치·자동 fix·배포는 허용하지도 실행하지도 않았다.

이전 [후보 보고서](2026-11-05-issue87-source-map-candidate.md)의 BLOCKED는 당시 기록이다. 실제 npm 결과가 없는 차단 상태를 PASS로 바꿔 적지 않고 이 별도 실행으로 구분한다.

## 입력 동일성 및 회귀 연결

| 검증 | exact SHA | 실제 실행 |
|---|---|---|
| production metadata 재audit | `3fdb1d1b4159484c45182e77a285d5f827ef5d5e` | [42032239269](https://github.com/rlawksml/word-html-studio/actions/runs/42032239269) PASS |
| 최신 제품 type/lint/build·277TC | `83fed460aa51ea62ef746ad1268c79da0fe53b92` | [42030911635](https://github.com/rlawksml/word-html-studio/actions/runs/42030911635) PASS(별도 이전 실행) |

두 source commit은 서로 다르다. audit 컨테이너는 제품 코드를 실행하지 않으며, 같은 공개 manifest pair를 정확한 hash로 연결한다. audit 도구 브랜치의 옛 앱 테스트 기준을 이번277 실행 증거로 쓰지 않는다.

- package:3,931B / `4b79c8d63413e685bbe8d04b199ff976c99c24b8257e9e66d5861f58e2eaf5e8`.
- lock:394,737B / `68297e0d957b93e270b6d70473b990b680a23afb45f5fd1ad8d9559f8e19cada`.
- 사전 검증:13개 native closure pin 일치·작업 트리 clean·원격 source exact·공개 저장소·중복 실행 없음·두 브랜치 manifest bytes 동일.
- 실제 audit 앞뒤 입력은 RO descriptor/hash로 검사하고, 완료 직전에도 고정 hash를 재확인한다.
- 제품의 source-map-js1.2.1→1.2.2 세 필드 외 lock 변경 없음·package 불변·다른734개 레코드/기존277TC 불변 증거는 [후보 보고서](2026-11-05-issue87-source-map-candidate.md)에 있다.

## TC 결과와 종료 증거

| TC | 우선순위 | 결과 | 실제 증거 |
|---|---|---|---|
| AUDIT-LIVE01 새 lock의 알려진 production high/critical0 | P0 | PASS | 실제 npm audit 결과의 전 등급/총합0, outcomePASS/reasonNONE. 제어 정책은 zero 결과의 npm exit0도 요구 |
| AUDIT-CONTROL01 입력·seal·엄격 정리 후 완료 | P0 | PASS | SEAL→FINAL→정리 후 COMPLETE·job성공·artifact0 |
| TC-SEC-001 나머지 실브라우저/DB·배포 후 확인 | P0 | BLOCKED | 이번 승인 범위 아님. 운영 GO로 처리하지 않음 |

표의 두 검사항목은 같은1회 actual audit에서 확인했다. 두 번의 독립 실행이나 새로운 단위 테스트2개로 세지 않으며 기존 native27·metadata29·제품277·과거 audit 결과에 합산하지 않는다. 이번에 native/앱 suite를 다시 실행한 것은 아니다.

고정 실제 marker(UTC):

- AUDIT `2026-11-05T13:03:01.5271976Z`.
- SEAL `13:03:06.1900886Z`.
- FINAL `13:03:06.3246640Z`.
- COMPLETE `13:03:06.5291104Z`.
- job 완료 `13:03:08Z`, conclusion success.

검토한 controller는 sealed-status에서 입력 hash·자식0·효과적 OS loopback-only·호스트 Networks[]·OOM 없음·최종 상태를 확인하고, 정확한 소유 컨테이너 정리가 성공한 뒤에만 COMPLETE를 출력한다. marker 이름만 보고 성공을 가정하지 않고 exact source의 제어 경로·API metadata·실제 고정 요약과 대조했다. 주 담당과 독립 Astra 검토자가 각각 확인했다.

## 실행 명령·안전 경계

기존 runner Node/npm과 필수 OS library만 검토한 FROM scratch 이미지로 복사했다. 공개 manifest2개만 RO로 넣고 앱·키·실제 npmrc·DB/사진·호스트 home/socket은 전달하지 않았다. 빈 allowlist 환경과 서로 다른 빈 npm config를 사용했다.

고정 명령은 `npm audit --package-lock-only --ignore-scripts --omit=dev --audit-level=high --json`이며 공식 registry, fetch timeout30초/retries0, scratch cache, wall90초·공유 stdout+stderr64KiB 상한을 사용한다. 설치·fix·서명검사·앱 실행·새 artifact 업로드는 없다.

비루트·cap-drop/NNP/seccomp·RO root/input/toolchain·scratch-only512MiB·메모리3GiB·CPU2·PID128·파일256MiB·CPU180초·controller8분/정리예약2분을 유지했다. audit용 bridge는 registry-only 방화벽이 아니다. 완료 뒤에는 효과적 loopback-only와 host Networks[]를 확인했다. 원문은 격리 컨테이너 내부에서만 일시 처리하며 고정 카운터/상태/공식 권고ID 요약만 공개한다.

DB 행·원본/미리보기·presence·세션·기존 백업은 생성·수정·삭제하거나 정리하지 않았다. 이번의 소유 컨테이너와 임시 자원만 격리 종료 절차로 처리했다.

## 한계와 다음 단계

- 이 결과는 이 시점 registry가 제공한 `--omit=dev` production metadata 결과다. graph 전송이 production 항목으로만 한정된다는 뜻은 아니며 full dev audit/#66 vinext·React/개발 Miniflare·sharp 해결을 증명하지 않는다.
- source-map-js 알려진 high 권고가 이번 새 lock 검사에서 더 이상 보고되지 않았음을 확인했다. 실제 공격 도달성·번들 전체 안전성·가용성 공격을 검증한 것은 아니다.
- full90초 지속·OOM·임의 descendant·FD identity race·seal/cleanup fault injection은 추가 실행하지 않았다.
- 제품 type/lint/build·277TC는 위 동일 pair의 별도 실행이며 이번 재audit에 포함하지 않는다. 이후 제품·manifest 변경 시 다시 범위별 검증해야 한다.
- #93 경로/TOCTOU, 경고/출력 요약, 실제 브라우저/Network/자원·DB/사진·동시 편집·통합본·#86 SQL·최신 독립 백업/새 빈 대상 복원·호환 exact fallback은 남는다.
- #87 이슈 종료·merge·배포는 하지 않는다. **이번 audit 범위 GO / 전체 운영 NO-GO**를 유지한다.
