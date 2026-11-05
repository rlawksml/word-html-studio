# 오프라인 앱 baseline 검증 — exact 기준선232 완료

## 판정

- 결과: **GO (검증한 오프라인 baseline 범위), 운영 전체 NO-GO**
- 단계: PRE-DEPLOY, 2026-11-05
- 범위: 기존 의존성 baseline의 준비 경계와 type/lint/build/기본 단위 검증. 기능 수정·의존성 업데이트·배포가 아니다.
- 검증자: 주 에이전트가 수동 CI를 시작했고, 독립 검토자는 source/runtime 10파일 closure를 검토했다. 이 문서 작성자는 대상 코드를 실행하지 않았으며, 별도 허용 후 후속2~16의 GitHub metadata와 검토된 고정 prefix 로그만 읽기 전용으로 대조했다. run12는 후보 브랜치의 별도 결과로 구분한다.
- **실행1~15의 실패·차단은 삭제하지 않고 아래 이력으로 보존한다. run16은 typecheck·lint·build·unit232/232·종료/실효 격리·소유 자원 정리의 완료 marker까지 독립 확인했다. 기준선 성공을 운영 배포·브라우저·실DB/복원·후보 성공으로 자동 승격하지 않는다. 후보247는 별도 exactrun을 이 문서 부록에서 독립 확인했다.**

## 검증 대상

- 프로젝트: 동네책방 소식 스튜디오, `apps/web`, 제품 `1.1.0-rc.1`
- 환경: 무료 표준 public GitHub Linux의 일회성 준비/오프라인 컨테이너. 운영·보관 Staging·사용자 기기 환경과 분리
- 최종 검증 exact SHA: `9485c798961646f3c1bde5140f9c9bcba7c0d7a8`
- 최종 실행: [run41985670521](https://github.com/rlawksml/word-html-studio/actions/runs/41985670521), offline job `127105746131`, success·종료07:14:24Z. 독립 metadata/고정 로그 대조 완료.
- 최초 실행: exact `c2b4520053b8fe673cc88064aba7acdce8674eb1`, [run41976102041](https://github.com/rlawksml/word-html-studio/actions/runs/41976102041), job `127075235235`. 시작·실패는 부모 관측 전달이며 문서 작성자가 원격 조회하지 않았던 이력이다.
- 대상 브랜치: `codex/*` feature만 허용. 후속2~11·13~16의 실제 branch는 `codex/m1-offline-app-validation`이며 run12만 `codex/m1-preprod-candidate`다. 실제 metadata를 독립 대조했고 각 exact head는 아래에 구분한다.
- 배포 버전/URL: 없음. 이번에 서비스 URL의 정상 여부나 실제 Supabase 상태를 확인하는 작업이 아니다.
- package SHA-256: `e3f68a51988dea68b01f2ba836c570ab209ab038ed507407b4c3697a648354ae`
- lock SHA-256: `18ff641e6f54f79d3c6158ba8717309e7e0e237eb65d7fdff6012b39d1433f34`

package/lock은 `.github/validation/offline-baseline.mjs`에 고정한 기존 기준이다. 이번 준비는 #87 Next 업데이트 또는 #66 vinext/React 호환 업그레이드의 성공 증거가 아니며, audit도 실행하지 않는다. 이전 보고서의67/17/129 등은 이번 exact SHA의 회귀 수에 더하지 않는다.

## 사용자 승인과 실행 경계

사용자는 무료 public GitHub Linux에서 테스트 의존성을 준비하는 제한된 예외를 승인했다. 준비 컨테이너에는 검토된 host Node/npm, CA, 고정 package/lock과 trusted launcher만 넣고 **앱 소스·비밀값·환경파일·DB 연결을 넣지 않는다.**

1. 준비 단계에서 `npm ci --ignore-scripts --no-audit --no-fund`를 실행한다. registry는 `https://registry.npmjs.org/`, 재시도0이며 실제 사용자/global 설정은 읽지 않는다. run7까지 두 설정 경로를 `/dev/null`로 지정했으나 이후 보완은 서로 다른 trusted read-only 빈 파일2개만 사용한다. 기존 lock의 registry/integrity·의존성 경계를 먼저 검사한다.
2. 이 단계는 Docker의 일반 **bridge**를 쓰는 예외다. registry 설정과 검토된 입력이 있어도 **등록소 전용 egress 방화벽이라고 주장하지 않는다.** lifecycle script 재활성화·npm update·lock 변경·실제 앱 실행은 허용하지 않는다.
3. 준비 완료/설치 프로세스 종료를 확인한 뒤 prep 네트워크를 차단한다. tmpfs 의존성 볼륨을 유지하기 위해 먼저 **network-none·RO toolchain consumer를 idle로 준비**하고 mount/ready를 확인한다. idle/status에서는 앱 코드를 실행하지 않는다.
4. prep의 최종 정지 상태를 대조하고 prep 컨테이너를 정확히 제거해 **부재를 확인한 다음에만** 오프라인 앱 검증을 시작한다. 제거 확인 없이 앱을 실행하거나 마지막 tmpfs mount를 먼저 없애는 우회는 없다.
5. 앱 단계는 network-none·비root·RO root/source/toolchain이며, 소스 digest를 확인한 뒤 앱 사본과 생성물만 제한된 `/scratch`에 쓴다. 실제 환경파일·SDK 실연결·운영 비밀값·호스트 사용자 파일은 제공하지 않는다.

계획된 한도는 prep memory3GiB/app2GiB·swap0·CPU2·PID128·CPU180초·파일256MiB·FD512·scratch512MiB·toolchain tmpfs2GiB다. 설치180초, 앱 각 단계120초의 wall 제한과 출력 상한이 있으며 실제 cgroup/mount/프로세스/환경 preflight를 확인해야 한다. 설정 값만으로 적용 성공을 단정하지 않는다. 일반 컨테이너·볼륨 정리도 실행별 nonce/label/ID로 확인한 자원만 대상으로 하며 DB/사진 정리가 아니다.

## 준비 중 발견한 소스 문제와 보완

trusted runtime 복사에서 ELF `PT_INTERP` 동적 loader도 일반 공유 라이브러리처럼0444로 두면 실행 권한 문제가 생길 수 있다는 **소스 리뷰 finding**이 있었다. 직접 interpreter로 식별·정규화한 loader만0555로 복사하고 일반 `.so`는0444를 유지하도록 보완했다. 중복 경로도 검토된 loader 권한만 상향한다.

이는 실제 앱 실행에서 관측한 FAIL이나 해결 완료 기록이 아니다. 변경 후 10파일 closure의 hash를 다시 고정하고 독립 소스 수용 검토를 거쳐 위 exact SHA 실행을 시작한 상태다. RO root·비root·capability 제거·네트워크 차단 조건을 완화한 것이 아니다.

### 최초 중단 뒤 소스 정합 발견·진단 보강

기존 고정 lock에는 `@tailwindcss/oxide-wasm32-wasi@4.2.1` 부모의 bundleDependencies와 정확히 일치하는6개 하위 `inBundle:true` 항목이 있다. 이들에는 개별 resolved/integrity가 없고 부모에는 공식 registry URL과 SHA-512가 있다. 기존 validator는 모든 비root 항목에 개별 resolved를 요구하므로 이 **변경하지 않은 원본 lock도 거부한다는 정적 정합 문제**를 확인했다. 이것이 최초 run의 실제 중단 원인이라는 연결 증거는 아직 없다.

후속 최소 수정은 exact 부모/version·정확6개 이름/버전·부모 bundle 집합·하위 경로·inBundle true·개별 resolved/integrity 부재·seen6만 예외로 확인한다. 일반 bundled 항목 허용이나 다른 경로/link 예외가 아니며, 일반 항목의 registry/SRI 및 기존 package/lock hash 검사는 유지한다. controller에는 허용된 고정 단계·오류 분류만 추가해 다음 실패 위치를 구분하도록 했다. raw message/stack/path/대상 로그 출력, 준비·인계·cleanup 또는 성공 조건의 완화는 없다.

당시 독립 읽기 검토에서 controller SHA `8fe34509e0f43beef14470cd9ee9363b6715267f0e87188ed31abfbc0bfbf8c2`, source validator SHA `221b247f4b9d044278db4ba36998843598fe0d73b6e0ea5afb9db20abd8f3c83`와 package/lock 불변을 대조했다. 이후 고정 runtime 단계 진단과 아래 관측 보완이 이어졌다. 각각 소스 수용 범위일 뿐 앱 검증 성공이 아니며, 매 변경에서 workflow pin·전체 closure와 새 exact feature SHA를 대조해야 한다.

## 변경 기능·기존 TC 매핑

| 검증 경계 | 연결 TC/자동화 | 기대하는 증거 | 배포 전 상태 |
|---|---|---|---|
| 무료·정확 SHA·고정 입력 | `.github/workflows/offline-app-validation.yml`, `offline-host-source.mjs` | public feature dispatch, exact SHA 및 package/lock·10파일 closure hash 일치 | PASS: run16 exact9485c79·검토 pin 및 완료 digest 일치 |
| 준비/인계/OS 격리 | `offline-host-controller.mjs`, `offline-host-docker.mjs`, 각 launcher/common | 준비 종료·RO consumer·prep 부재·실효 OS 한도를 순서대로 확인 | PASS: run16 순서/검사와 최종 완료 확인 |
| 타입 | TC-TYPE-001, TypeScript CLI | 모든 소유 타입 검사 오류0, 정상 종료·OOM/제한 없음 | PASS: run16 exit0·출력0, 과거 실패 이력 유지 |
| lint | 기존 배포 전 lint gate, ESLint CLI | 고정 소스 lint 정상 종료. 경고 수는 별도 기록 | PASS: run16 exit0·출력0·관측 warning0 |
| build | TC-TYPE-002 중 build, vinext CLI | 오프라인 production build 정상 종료·부족한 native 산출물 우회 없음 | PASS: run16 exit0·blockedReason null·관측 warning2 |
| 기본 단위 | TC-TYPE-002 중 단위 및 저장/사진/HTML/날짜/digest/보호 경계 | 고정25파일의 실제 TAP 등록·성공232, 실패/취소/skip/todo0 | PASS: run16 실제232/232·나머지0·종료 검사 완료 |

최초25파일의 `EXPECTED_TESTS=231`은 정적 예상수였고 run15는 실제231/231만 확인한 뒤 최종 종료에 실패했다. HTML 종료 TC1개 추가 후 run16의 **실제 등록/성공은232/232·나머지0**이다. 이 둘을 합산하지 않는다. Stage2 SDK mock도 목록에 포함되지만 실제 DB·Storage 검증은 아니다. 개별 source-policy 전용 suite, Worker/브라우저·실제 통합 TC 전체를 이 기본 목록으로 대신하지 않는다.

## TC별 준비·검증 기준

| TC ID | 우선순위 | 종류 | 결과 | 통과로 변경하려면 필요한 실제 증거 |
|---|---|---|---|---|
| OFF-01 | P0 | 실행 guard | PASS | run16 manual feature metadata/exact9485c79·guard success, 공개 runner job 실행 조건 일치 |
| OFF-02 | P0 | 입력 경계 | PASS | 검토10파일 pin·기존 package/lock·완료 source digest61ce098… 일치, 다른 자료 제외 정책 유지 |
| OFF-03 | P0 | 의존성 준비 | PASS | run16 npm exit0·signal null·limited/error false·blockedReason null·관측 warning2. 과거 실패는 보존 |
| OFF-04 | P0 | 인계 | PASS | run16 SEAL_PREP→RO consumer ready→HANDOFF의 prep 상태/부재 확인 뒤 APP_RUN, 완료 marker까지 확인 |
| OFF-05 | P0 | OS preflight | PASS | 검토 exact 소스의 단계 전후 실효 OS·RO/망/환경·엄격 프로세스 부재 조건과 최종 검사 통과 경로 확인 |
| OFF-06 | P0 | 타입 | PASS | run16 exit0·signal null·limited/error false·blockedReason null·출력0 |
| OFF-07 | P0 | lint | PASS | run16 exit0·signal null·limited/error false·blockedReason null·출력0·관측 warning0 |
| OFF-08 | P0 | build | PASS | run16 exit0·signal null·limited/error false·blockedReason null·관측 warning2 |
| OFF-09 | P0 | 단위 | PASS | run16 실제 tests232/pass232/fail0/cancelled0/skipped0/todo0·expected/no-notok/no-bailout 검증 및 종료 완료 |
| OFF-10 | P0 | 자원 종료 | PASS | exact 소스상 finally의 이번 소유 컨테이너·볼륨 정리 성공 뒤에만 완료 marker 출력. 광역 삭제 없음 |
| OFF-11 | P0 | 증거 대조 | PASS | 실제4stage·카운터·FINAL_CHECK·정리 뒤 COMPLETE·exactcommit/source/package/lock/232 대조 완료 |

아래 집계는 **운영 TC 전체나232개 단위 수가 아니라 위 OFF 준비/완료 경계11개의 현재 상태**다. 과거 실패를 삭제한 누적 성공 집계가 아니다.

| PASS | FAIL | BLOCKED | SKIPPED | 전체 |
|---:|---:|---:|---:|---:|
| 11 | 0 | 0 | 0 | 11 |

## 최초 실패·차단 상세

- 전달된 관측: run41976102041의 offline job127075235235가 약4초 후 `OFFLINE_TRUSTED_CONTROL_OR_PREFLIGHT_FAILED`로 중단했다. 시간·코드는 주 에이전트 관측이며 작성자가 별도로 API를 조회하지 않았다.
- 기대: 검토한 제어 경계·입력·실효 격리 조건을 통과한 뒤 typecheck/lint/build/unit와 정확231 TAP 및 소유 자원 정리의 증거가 있어야 한다.
- 실제: generic 고정 코드만으로는 실패한 세부 단계·원인을 확정할 수 없다. 앱 단계가 성공했거나 제품 기능 TC가 실패했다는 증거로 해석하지 않는다. 최초 run 기준 OFF-11은 실행 완료 증거 불충족으로 FAIL이고 나머지는 확인 불가였다. run7의 준비 실패와run8의 준비 단계 한정 성공은 후속 표로 구분한다.
- 후속: 허용된 고정 단계/오류 분류만 보강하는 제어 진단 변경을 독립 검토한다. raw 예외·stack·대상 stdout/stderr·경로·비밀값을 출력하거나 입력 검증/격리/성공 기준을 완화하지 않는다. 실제 수정 SHA와 다음 run은 별도로 기록한다.
- 우회: 없음. lifecycle script 활성화·online app·무제한 환경 실행·실DB 연결로 통과시키지 않는다.

## 후속 실행 이력 — metadata·허용 prefix 독립 대조

아래2~11·13~16 및 별도 후보run12는 허용된 읽기 전용 조회로 head SHA·branch·job conclusion과 실제 고정 `OFFLINE_CONTROL_STAGE`, `OFFLINE_RUNTIME_STAGE`, `OFFLINE_TRUSTED_ENV`, `OFFLINE_TRUSTED_COMPAT`, `OFFLINE_IMAGE_*`, `OFFLINE_STAGE_SUMMARY`, `OFFLINE_APP_CONTROL`, `OFFLINE_TYPECHECK_DIAGNOSTICS`, `OFFLINE_NATIVE_LIBRARY_TOKENS`, `OFFLINE_PROCESS_SUMMARY`, `OFFLINE_UNIT_COUNTERS`, `OFFLINE_APP_COMPLETE`, `OFFLINE_CONTROL_FAILURE` 줄만 대조했다. 원시 앱/설치 로그·환경값·daemon JSON·이미지/컨테이너 ID 원문은 출력하지 않았다. 각 guard는 success이고 일반 verify·실Supabase·source-policy·rollback job은 skip이었다. run16만 baseline 전체 범위 성공이며 실제 통합 TC 성공은 아니다.

| 회차/run | exact SHA | offline job/종료 UTC | 확인한 경계와 결과 |
|---|---|---|---|
| 2 / [41976786364](https://github.com/rlawksml/word-html-studio/actions/runs/41976786364) | `6033225aceb285bd38bc5d67b56643e833d34d7f` | `127077417959` / 05:53:16 | FAIL: DAEMON_LIMITS → RUNTIME_PREP, ERR_ASSERTION. runtime 세부 위치는 당시 미계측 |
| 3 / [41977086980](https://github.com/rlawksml/word-html-studio/actions/runs/41977086980) | `971f566a4d159853d366b60816729e76a3596d96` | `127078375849` / 05:56:15 | FAIL: runtime PATHS/NPM_METADATA/NODE_VERSION/NODE_COPY 뒤 ENV_COPY 진입·ERR_ASSERTION |
| 4 / [41977365955](https://github.com/rlawksml/word-html-studio/actions/runs/41977365955) | `8d9fc72011d96e4ddecf950497341093f0e173c9` | `127079290876` / 05:59:01 | FAIL: ENV_COPY에서 trusted env 크기11807104·USR·regular1 관측 뒤 거부 |
| 5 / [41977669845](https://github.com/rlawksml/word-html-studio/actions/runs/41977669845) | `e49224033a810cdc661622e0335a39e866462367` | `127080253877` / 06:01:57 | FAIL: runtime prep/app·SOURCE_VALIDATION 뒤 IMAGE_BUILD_PREP/ERR_ASSERTION. image 세부 조건은 당시 미계측 |
| 6 / [41977987777](https://github.com/rlawksml/word-html-studio/actions/runs/41977987777) | `a820654719cb5dbabb28c048c5fb49d10539f306` | `127081282485` / 06:04:56 | FAIL: IMAGE_BUILD_PREP의 identity/owned/user/entrypoint/volumesAbsent true, envAbsent false·envCount1·dockerDefaultPath true 뒤 ERR_ASSERTION |
| 7 / [41978282849](https://github.com/rlawksml/word-html-studio/actions/runs/41978282849) | `445a9bd8aabc7a84c53f82b75d1cc45851b5b187` | `127082231606` / 06:07:51 | FAIL: images/volume/create/start 뒤 PREP_STATUS, 실제 npm 준비 exit1·stderr117bytes·stdout0·signal null·limited/error false |
| 8 / [41978903379](https://github.com/rlawksml/word-html-studio/actions/runs/41978903379) | `6c7b57b4da1570fae71f301660cb33a8c81a82c8` | `127084200327` / 06:13:45 | FAIL: npm 준비 exit0 뒤 SEAL_PREP→CONSUMER_READY→HANDOFF→APP_RUN, 약142ms 후 고정 OTHER 실패. 앱 단계별 요약0 |
| 9 / [41979930103](https://github.com/rlawksml/word-html-studio/actions/runs/41979930103) | `1ef7ebe1e5841f09ecc28f914df4e79d89661b83` | `127087480411` / 06:23:02 | FAIL: npm 준비 exit0·오프라인 인계 뒤 TYPECHECK 진입, 실제 typecheck exit2·stdout120bytes/stderr0·signal null·limited/error false·blockedReason null. 이후3단계 미실행 |
| 10 / [41980736350](https://github.com/rlawksml/word-html-studio/actions/runs/41980736350) | `c98a680a51c46ec20385c4a741aa7f69067324e7` | `127090056265` / 06:30:22 | FAIL: npm 준비 exit0·오프라인 인계 뒤 typecheck exit2·stdout120bytes/stderr0·signal null·limited/error false·blockedReason null. 제한된 진단 TS2307 / vite.config.ts:3:27. 이후3단계 미실행 |
| 11 / [41981594338](https://github.com/rlawksml/word-html-studio/actions/runs/41981594338) | `9ecde23628dfb366d0f8e6ccce8041951e553367` | `127092731130` / 06:38:01 | FAIL: npm 준비0, 실제 typecheck0·lint0(출력0), build1·NATIVE_SHARED_LIBRARY_UNAVAILABLE·stderr3092bytes. 단계3개·unit 미실행 |
| 13 / [41982373548](https://github.com/rlawksml/word-html-studio/actions/runs/41982373548) | `d84e455c9803c356f90f89400870359210abf495` | `127095242533` / 06:44:56 | FAIL: npm 준비0·typecheck0·lint0, build1·native 공유 라이브러리 준비 차단·stderr3092bytes. loader 문맥 토큰 librt.so.1 한 개·unit 미실행 |
| 14 / [41983029613](https://github.com/rlawksml/word-html-studio/actions/runs/41983029613) | `ac13637f597b3b2e662ae650ea831c9e91103532` | `127097322696` / 06:50:54 | FAIL: npm 준비0·typecheck0·lint0·build0(관측 warning2)·unit0 이후 POST_STAGE/OTHER. TAP 카운터 검증 완료 증거 없음 |
| 15 / [41983806604](https://github.com/rlawksml/word-html-studio/actions/runs/41983806604) | `e4aaf2f18ae2b5c18ab6c9af429c4b97cf45543b` | `127099785543` / 06:58:05 | FAIL: 준비/type/lint/build/unit exit0·실제 TAP231/231·나머지0. POST_STAGE/UNEXPECTED_PROCESS_REMAINS, live0/zombie1/parent1=1/esbuild1·그외0 |
| 16 / [41985670521](https://github.com/rlawksml/word-html-studio/actions/runs/41985670521) | `9485c798961646f3c1bde5140f9c9bcba7c0d7a8` | `127105746131` / 07:14:24 | PASS: 준비/4stage exit0·실제 TAP232/232·나머지0, 엄격 POST_STAGE/OS/FINAL_CHECK 및 소유 정리 뒤 COMPLETE. build 관측 warning2 |

별도 후보run12 [41981798820](https://github.com/rlawksml/word-html-studio/actions/runs/41981798820)는 exact `6c0f695a216f2eb4c6e8854b585e0d313b95a2a6`, job `127093392280`, 종료06:39:50Z·failure다. 후보의 npm 준비0·typecheck0·lint0·build1(동일 고정 native 분류·stderr3092bytes/해시)은 독립 확인했지만 unit는 미실행이므로246개 성공이 아니다. baseline231와 후보246, 별도 source-policy99는 서로 더하지 않는다.

### 관측으로 연결한 최소 보완

- run4의 trusted runner `env`는11807104bytes로 기존1MiB 입력 cap보다 컸다. canonical `/usr/`·regular file 확인은 유지하고 이 도구의 입력 한도만16MiB로 보완했다. 전체 runtime440MiB·OS memory/disk/CPU/PID/network 조건은 바꾸지 않았다. GNU/Rust 등 구현 종류를 추정하지 않는다. run5에서 다음 경계 진입을 확인했으나 앱 성공을 뜻하지 않는다.
- run6은 이미지의 다른 고정 조건은 맞지만 Docker 기본 PATH 한 항목 때문에 기존 Env-empty 조건에서 거부된 것으로 소스·실제 boolean을 대조했다. 후속 소스는 empty Env 또는 **정확한 고정 기본 PATH 단일 배열만** 허용한다. 임의 값·추가 환경변수를 허용하지 않고 PID1/exec의 `env -i`, launcher의 정확한 실효 환경 검사를 유지한다.
- 위 이미지 보완을 독립 source 리뷰한 hash는 `f08f44f8407f481356dd921647850d8a874b9eb9315c7207e0fedd872bc04476`이다. 새 pin/전체 closure/새 exact SHA가 필요하며 후속 실행 성공은 아직 확인하지 않았다.
- bundle lock 정합 문제는 실제 검증기에 존재했던 별도 소스 finding이다. run2~4는 SOURCE_VALIDATION 이전에 실패했으므로 그 오류를 이들 run의 실제 원인으로 표시하지 않는다.

run7의 고정 요약은 blockedReason null·관측 warning0이며 stderr SHA-256은 `250e369d730a46c4d41df37449a5c58c169b4b1d2ab546951a8bed0285805a95`다. 원시 stderr는 읽지 않았다. USERCONFIG/GLOBALCONFIG가 모두 `/dev/null`인 소스의 중복 설정 가능성은 조사 후보이며 실제 메시지나 이 실행의 근본 원인으로 단정하지 않는다.

후속 config 보완은 prep image 안에 서로 다른 `/trusted/npm-user.conf`, `/trusted/npm-global.conf`를 빈0444 파일로 만든다. launcher는 distinct path·regular/non-symlink·size0·mode444·read0을 확인하고 PREP_ENV와 고정 argv에 같은 두 경로를 사용한다. 실제 host 설정은 복사하지 않고 app 환경·설치 script/audit/망/lock/한도·인계 조건도 변경하지 않는다. 내부 요약이 `double-loading config`를 관측하면 고정 `DUPLICATE_NPM_CONFIG_PATH` 분류만 내보내며, 성공 판정은 여전히 exit0·blockedReason null을 요구한다. 이 source 리뷰는 해당 수정 수용 범위일 뿐 run7의 실제 원인이나 다음 설치 성공을 확정하지 않는다.

run8은 npm 준비 요약 exit0·signal null·limited/error false·blockedReason null, stdout26bytes/stderr166bytes·관측 warning2다. stdout SHA-256은 `61f81f95108c0f5981c16b43f81cdc9e531feb14aee4b494f88ec36e5f59325f`, stderr SHA-256은 `49b7f4b5c04d0a1a4eea7ddfb3498179b5db0f308c87ab96252f3b259c4b6734`다. 원시 내용과 경고 종류는 읽지 않았다. 06:13:42.448Z APP_RUN 뒤42.590Z에 고정 실패했으며 typecheck 요약도 없다. 초기 clone/preflight/link 중 어느 지점인지는 이 로그만으로 확정할 수 없다.

추가 소스 검토에서는 host가 Git tree 순서로, consumer가 디렉터리별 정렬 DFS 순서로 digest를 누적하는 불일치를 찾았다. 실제 Git 경로의 `apps/web/drizzle.config.ts`는 `apps/web/drizzle/meta/_journal.json`보다 먼저지만 DFS는 반대다. 후속 소스는 기존 파일 수/바이트 한도 안의 relative path·파일 hash를 모아 UTF-8 byte 순서로 정렬하고 같은 구분자로 digest를 계산한다. 파일 읽기/쓰기 순서·값·count/bytes·package/lock 검사는 그대로다. 이것은 실제 tree에 존재하는 정적 계약 문제이며 run8 catch 위치를 직접 관측한 증거로 대신하지 않는다.

이 보완의 app launcher SHA `54b4ac4ff763ea7c617806fbeffab86954864ffa2f257daa7a3853095810ad13`, controller SHA `c36fd01c9903bd9e9dbacfbf16d56c0af257cd72ca192401e095203d51865144`를 독립 읽기로 대조했다. 앱 실패도 nonce·고정 phase/category만 JSON으로 전달하고 host가 정확한 enum을 검증한 후에만 출력한다. raw 예외·stack/path는 내보내지 않으며 성공/자원 정리·OS/argv/TAP 조건은 유지한다. source 수용 검토일 뿐 다음 실행 결과가 아니며 새 pin·exact SHA 확인이 필요하다.

run9는 06:22:54.527Z APP_RUN 뒤06:23:00.303Z에 `phase=TYPECHECK category=OTHER`와 typecheck 실패 요약1개를 반환했다. stdout SHA-256은 `ac3b98177f456ff78fa3afc8488a0a4090ddf5cd615767f917594de6ee4f3327`, stderr는 빈 바이트의 SHA-256이었다. 원시 타입 오류문을 읽지 않았으므로 오류 코드·파일·의존성 문제 여부를 아직 단정하지 않는다. 제어 소스상 source clone/digest·toolchain link를 지난 뒤 실행하는 타입 단계에 도달했다는 범위만 확인한다. source digest 원문·정확한 최종 완료 marker와 개별 OS 관측 전체가 확인된 것은 아니다.

후속 진단 보강은 실패한 typecheck stdout에서 최대20개의 TS 숫자 코드와 검증된 public Git 소유 파일/정수 좌표만 추출한다. consumer는 source digest 일치 뒤에만 소유 경로 집합을 채우고 host가 원본 Git 소유 경로와 재대조한다. 메시지·모듈명·환경값·stack·비소유 경로는 내보내지 않고 sourcePaths는 이미지 metadata에 추가하지 않는다. app SHA `884d034f865da1035543515d031a1f9973592065bffd13166cfcceeb1dcca8a9`, controller SHA `82b71bef3f8980e9d5c197654600f2f1dae2f55fc0665c76bc346b8a40c9b1a4`, host source SHA `cead6d6acc4573ae9b92924c33c57248b2e3b27ec4f074db872d5ce92d0e339c`를 독립 읽기로 대조했다. 검사/성공·TAP·격리·cleanup 조건은 유지한다.

run10의 실제 진단은 TS2307 / `vite.config.ts:3:27` 한 개다. 원시 오류 메시지는 읽지 않았다. 소유 소스 line3이 `./.openai/hosting.json`을 정적 import하고 검증 source 정책은 `.openai` 전체를 제외하는 경계 정합을 확인했다. 해당 host 설정 파일·키는 열거나 복사하지 않았다. 제한을 풀어 host 설정을 집어넣는 우회 대신 비밀값이 필요 없는 공개 설정 경계의 최소 수정 검토가 남는다. run9와 동일한 stdout 길이/해시만으로 두 실행의 원시 메시지가 완전히 같다고 추가 주장하지 않는다.

이후 최소 보완 검토에서는 **현재 public Git 소유 `apps/web/.openai/hosting.json` 정확1개**만 구분했다. 원본을 host 설정으로 간주해 일반 복사하지 않고 Git c98a680의 byte hash `fdde6bbbd403d41bdc66eb6959189cf7879ca74a45a4895191ecbe33af671426`, 91bytes와 키 집합/schema의 boolean만 독립 대조했다. 실제 프로젝트 식별자나 내용은 로그·이 문서에 싣지 않는다. 검증기는 literal 경로1개에만 예외를 두되 기존 정규경로·regular/Gitblob 검증, 크기1KiB 이하·exact SHA·정확3키·D1/R2 strict null·고정 식별자 형식을 모두 요구한다. 다른 `.openai`·env·host 설정 금지는 유지하며 제품 import나 파일값을 fixture로 재작성하지 않는다. source hash `f7e596086f32463a9a98421acf3d3c963fc1844d56cd0762d224a87e71fc67b1`와 다른9 closure 불변을 독립 확인했다. 이후 run11에서 타입·lint 실제 성공을 확인했으나 build까지 성공한 것은 아니며 실제 DB/Storage 바인딩·비밀값을 허용한 것도 아니다.

run11의 typecheck·lint는 각 exit0·signal null·limited/error false·blockedReason null이고 stdout/stderr 모두0이다. build는 exit1·signal null·limited/error false·고정 `NATIVE_SHARED_LIBRARY_UNAVAILABLE`, stdout0/stderr3092bytes이며 stderr SHA-256은 `5725533ee2221f25e3067a6d57febbd5af654c74f64ebdd295171f69733b76b7`다. 당시 원시 stderr와 특정 라이브러리 이름을 읽거나 추정하지 않았다. 단위 단계는 실제 미실행이다.

run13의 추가 진단은 실패 출력에서 `<정확한16개 OS 라이브러리 literal>: cannot open shared object file` 문맥만 선별하고 host가 배열 길이·허용 멤버·중복없음을 검증한다. common SHA `18e576e8d2f0123a38ce28d76ea939099b1ae98705115868f860cf5cca72861b`, controller SHA `46066b70266183bf66dae3da37a1cf538252a4ef2baf7095a9b4aadc2112712c`를 독립 읽기 검토했다. 실제06:44:54.088Z의 안전 진단은 build 토큰 `librt.so.1` 한 개다. 이는 stdout/stderr 합친 제한 텍스트의 loader 문맥 관측이며 원시 메시지·대상 경로·새 복사 성공을 뜻하지 않는다.

후속 runtime 소스 보완은 이미 runner에 존재하는 `/usr/lib/x86_64-linux-gnu/librt.so.1` 정확1개만 x64·canonical prefix·root 소유·group/other 쓰기 불가·regular/ELF·16MiB 검증 후0444로 복사한다. `ldd`는 기존 trusted Node/env와 이 known OS 라이브러리에만 적용하고 앱/다운로드 binary에 실행하지 않는다. 기존 Node/env interpreter1 조건, dependency64MiB·runtime총440MiB·OS/인계/성공 기준을 유지하며 중복 canonical/실제 bytes도 대조한다. runtime SHA `9fc295a1ea304d7cfb4075168f169bad4b484dea787426a8d05e5199eced9023`, controller SHA `56124428d368b96fda0e1a3a8711999a81089f5f8fee6d94bfc95bf16f34a821`를 독립 source 검토했다. 새 설치·script 활성화·online/host fallback은 없다. 이후 run14는 trusted librt14624bytes 준비와 build 정상 종료를 확인했지만 최종 검증은 아래처럼 차단됐다.

run14의 실제 build는 exit0·signal null·limited/error false·blockedReason null, stdout1590/stderr722bytes·관측 warning2다. unit도 같은 정상 종료 메타데이터이고 stdout53895/stderr0bytes이나 그 뒤 `phase=POST_STAGE category=OTHER`로 실패했다. 당시 소스는 unit TAP 검증보다 quiescence/실효 preflight를 먼저 수행하므로 stdout 길이·exit0만으로 tests231/pass231을 확정할 수 없다. 원시 TAP를 읽지 않았고 특정 잔여 프로세스·좀비·제품 메모리 누수도 아직 관측하지 않았다. 실패 분류·닫힌 프로세스 집계 진단과 TAP 카운터 선확인을 검토할 수 있으나 최종 quiescence/OS 조건을 제거·완화하거나231 성공으로 추정하지 않는다.

후속 app SHA `2da2684a0c3439ce235e858c64bc1074df35e5be8d81043a2d017105d89e8f25`와 controller SHA `cce523c50d4f6bb3bff67c502eb8132fe0d89c2210305527517b653e80cf690e`를 독립 source 검토했다. quiescence20회 실패 뒤에만 `/proc` numeric128개 이하·status16KiB 이하를 읽고 고정8개 정수 집계만 공개한다. host가 정확 키/정수범위/집계합을 재검증하며 raw PID/comm/status/명령은 공개하지 않는다. unit는 TAP 숫자 관찰·정확 검증을 quiescence 앞으로 옮기지만 최종 quiescence/실효 OS/완료 조건은 그대로 필수다.

run15의 실제 안전 진단은 `POST_STAGE / UNEXPECTED_PROCESS_REMAINS`, live0/zombie1/gone0/parent1=1/esbuild1 및 node/workerd/other0이다. 실제 unit counters는 tests231/pass231/fail0/cancelled0/skipped0/todo0이고 검토 소스상 POST_STAGE는 expected/no-notok/no-bailout 검증 뒤에만 진입한다. 따라서 단위 TAP는 부분 PASS로 구분하되 원래 noOtherProcesses가 좀비도 거부하므로 전체 CI는 여전히 실패다. 이 테스트 격리 프로세스 관측을 실제 운영 제품의 heap·메모리 누수 유무 판정으로 확대하지 않는다. 후속은 테스트가 시작한 정확한 esbuild 자식 handle의 stop/close 대기 설계를 검토할 수 있으며 좀비 무시·PID 임의 kill·sleep·검사 완화로 통과시키지 않는다. 추가 등록 계획은 기존 HTML01~05를 유지한 여섯번째 TC1개이며 기준232/후보247는 아직 새 실행 결과가 아닌 계획이다.

후속 fixture 최소 수정의 독립 소스 검토는 최종 helper `ee66fbfad68a5cbff49772d496f3e714bbbdb8c70893e3b6e8278b0370761abe`(68줄), HTML test `4d9f616c52865b681b586949499698a3b67e42ee515b0f92efe067ceed41a396`(86줄), baseline `d352fca43a785f3ea1741d3e9920d3c2ecac01ce421a25d6938c3447c1845bfe`를 대조했다. 테스트 번들 중 임시 spawn 계측으로 정확 서비스 version/args·canonical 패키지 binary의 단일 ChildProcess handle만 소유하고 다른 spawn은 원래 함수로 전달한다. finally에서 원래 spawn을 복원한 뒤 해당 SDK stop과 실 close 이벤트를 같은5초 race 안에서 기다리고 timer/unref/active 해제를 보장한다. stop 지연이 timeout 소비 밖에 있던 최초 초안은 소스 리뷰로 정정했으며 실행 결과로 취급하지 않는다. lifecycle 반환은 상수 대신 실제 owned 존재와 closed 관측의 Number 값이다. 기존 HTML01~05와 제품 코드는 그대로이고 HTML06만1개 추가·helper 자체 등록0으로232 예상이었다. 이후 run16에서232 실제 TAP·HTML06과 엄격 종료 검사를 함께 확인했다.

run16에서는 실제 typecheck·lint exit0/출력0, build exit0·stdout1590/stderr722bytes·관측 warning2, unit exit0·stdout54119/stderr0bytes를 확인했다. 모든 단계는 signal null·limited/error false·blockedReason null이다. 07:14:22.197Z 실제 unit counters232/232·나머지0 뒤 FINAL_CHECK, 22.741Z 완료 marker가 나왔다. exact controller 소스를 다시 읽어4stage/정확 TAP·commit/source digest·최종 inspect·signal/OS 검사를 거친 뒤 finally의 이번 소유 자원 정리까지 성공해야만 COMPLETE를 출력함을 대조했다. 완료 source SHA-256은 `61ce098370811c6a9dea43077ee65c5de41f2f123dd5c1925a7b044c7ee49a0e`, package/lock은 위 고정값이며 tests232다. 원시 로그를 공개하거나 단순 exit0만을 성공으로 쓴 것이 아니다.

준비 인프라 실패들을 제품 기능 FAIL8건 또는231개 단위 FAIL로 계산하지 않는다. run9·10 타입 실패·run11·13 build 차단·run14 카운터 미확인·run15 최종 좀비 거부를 모두 보존한다. 현재 OFF 경계11개는 **run16 exact 기준선 범위에서11PASS**이며 실단위232와 중복 합산하지 않는다. 운영 GO·새 QA/DB 접근·실제 메모리 누수 부재·후보247 성공은 보고하지 않는다.

### 이번 범위 밖

- SKIPPED: #91 빈 발행 월의 실제 UI 재현/수정. 이 baseline은 기능 수정 결과가 아니다.
- SKIPPED: Playwright/Miniflare/모바일 사용성·실제 clipboard·외부 편집기·반복 heap/DOM/listener·실서버 로그 검증.
- SKIPPED: 실제 Supabase 세션·편집 임대·동시 저장·업로드/다운로드·HEIC/불안정망·SQL·복원. 실제 연결/새 QA 쓰기는 별도 승인 대상이다.
- SKIPPED: #87/#66 의존성 변경·새 lock·audit 재실행. 고정 baseline의 설치는 보안 업그레이드가 아니다.
- SKIPPED: 배포 및 운영 GET/HEAD 스모크. 현재 원격 서비스 정상 여부를 보고하지 않는다.

## 실행 명령 — 컨테이너 안의 고정 argv

호스트에서 아래 저장소 명령을 직접 실행하라는 안내가 아니다. lifecycle script 없이 준비한 RO toolchain과 OS 격리 조건 안에서만 launcher가 실행한다.

| 단계 | 고정 CLI | 현재 증거 |
|---|---|---|
| typecheck | TypeScript `tsc --noEmit --incremental false` | run16 exit0·출력0 |
| lint | ESLint `. --ignore-pattern dist --ignore-pattern .next` | run16 exit0·출력0·관측 warning0 |
| build | vinext `build` | run16 exit0·관측 warning2 |
| unit | Node `--test --test-reporter=tap --test-concurrency=1` + `offline-baseline.mjs`의25파일 | run16 실제 TAP232/232·나머지0·최종 종료 완료 |

## 실제 결과 — 최종 독립 대조

아래는 run16의 실제 stage 요약·등록수·검토 exact 소스와 완료 marker를 독립 대조한 결과다. raw 대상 stdout/stderr, 환경값, 비밀값, 세션, 사용자 본문·생성물은 공개하지 않았다.

- metadata/branch/head/conclusion 및 종료 시각: **run16 exact9485c79·feature/manual·guard/offline success·07:14:24Z. 과거2~15 실패와 후보run12 별도 보존**
- source/package/lock digest 대조: **실제 COMPLETE의 source61ce098…·packagee3f68…·lock18ff…·tests232와 검토 exact 소스/기준 일치**
- npm 준비 exit/signal/limited·경고 수·출력 hash: **run16 exit0·signal null·limited/error false·blockedReason null·관측 warning2. 출력 요약 digest만 확인**
- consumer 인계/prep 부재/OS preflight: **검토 소스의 필수순서/실효 검사와 actual 단계/완료 marker 연결 확인**
- typecheck/lint/build 각각의 실제 stage 결과: **run16 각각 exit0·signal null·limited/error false·blockedReason null; build 관측 warning2**
- unit 실제 TAP tests/pass/fail/cancelled/skipped/todo: **run16 실제232/232/0/0/0/0·no-notok/no-bailout·최종 종료 검사 완료**
- 소유 자원 정리 및 최종 `OFFLINE_APP_COMPLETE` 여부: **exact 코드의 엄격 검사/소유 cleanup 이후 실제07:14:22.741Z marker·job success 확인**
- 실패의 고정 코드·영향·다음 조치 및 재실행 exact SHA: **최초~run15 실패는 위 이력, run16 기준선은 완료. 후보fbeec72690818e2ec66ca395957c6dfb83c5a70d/run41985974193의247 성공은 별도 부록 확인**
- 독립 검토자·확인한 metadata/log 범위·최종 OFF 집계: **독립 안전/문서 검토자가 후속2~16 metadata·고정 prefix/정확 소스 조건을 대조. run16 OFF 경계11PASS, 운영전체NO-GO**

## 별도 후보247 — 합산하지 않는 독립 대조 부록

**TC ID 보존 주석:** 아래 기준선9485c79와 후보fbeec726의 신규 자식 종료 자동 case는 당시 `HTML-LINES-06`으로 명명돼 있었다. 기존 카탈로그의06은 실제 외부 편집기 수동 검증이므로 이 과거 자동 성공을 수동06 PASS로 해석하지 않는다. 이후 자동 case의 ID만 `HTML-LINES-07`로 정정했다. 원래 수동06 행과 과거 실행의 source/hash/라벨 이력은 변경하지 않았고 최신07 후보는 아래 별도 실행에서 재확인했다.

- 실행: [run41985974193](https://github.com/rlawksml/word-html-studio/actions/runs/41985974193), job `127106698816`, branch `codex/m1-preprod-candidate`, exact `fbeec72690818e2ec66ca395957c6dfb83c5a70d`.
- metadata: workflow_dispatch, guard/offline job success·종료07:16:56Z. verify·Supabase·source-policy·rollback job은 SKIPPED.
- 실제4stage 모두 exit0·signal null·limited/error false·blockedReason null. typecheck/lint 출력0, build1590/722bytes·관측 warning2, unit58002/0bytes. npm 준비도 정상·관측 warning2다.
- 07:16:53.263Z 실제 counters247/247/fail0/cancelled0/skipped0/todo0 뒤 FINAL_CHECK, 53.795Z 정확 COMPLETE를 독립 확인했다.
- 완료 source SHA-256: `07f2bcaa9fcc4b1dd1decd856cf06d80df4dbced8482117ff2cece1289094a14`, package `cdc5fde96aa6665a7642b256a2b4329e2a9dee147bbd12981df3c35e38199fa9`, lock은 기준선과 동일한 `18ff641e6f54f79d3c6158ba8717309e7e0e237eb65d7fdff6012b39d1433f34`, tests247.
- immutable 후보 소스의26파일/expected247와 controller hash `cce523c50d4f6bb3bff67c502eb8132fe0d89c2210305527517b653e80cf690e`가 검토한 엄격 종료·격리·cleanup 이후 완료 조건과 동일함을 대조했다.

판정은 **후보 exact 오프라인 범위 GO / 운영전체 NO-GO**다. 기준선232·이 후보247·별도 native99는 중복 검증이 포함되므로 합산하지 않는다. 후보run12의 과거 build차단·unit미실행도 그대로 보존하며 이후 성공으로 과거 실패를 덮지 않는다. 이 부록은 브라우저·실DB/복원·#87 audit·Next/React 업데이트·실운영 정상 상태의 증거가 아니다.

### ID07로 정정한 최신 후보247 — 별도 exact 재검증

- immutable diff는 기존 후보fbeec726→`fb75c6264a597082e29cecbd23fb63144d78d5ac`에서 HTML test의 자동 이름06→07 한 줄뿐이다. assert·등록수·helper·10파일 검증 closure·package/lock은 동일하며 새 HTML test SHA-256은 `b01a03961a51e98291963bbdaf5b141102920b517efe9e5830820a4537d19419`다.
- [run41987069058](https://github.com/rlawksml/word-html-studio/actions/runs/41987069058), job `127110245660`, exact `fb75c6264a597082e29cecbd23fb63144d78d5ac`, branch `codex/m1-preprod-candidate`: metadata의 manual/guard/offline success·종료07:25:54Z를 독립 확인했다. verify·실Supabase·source-policy·rollback job은 SKIPPED다.
- 실제4stage 각각 exit0·signal null·limited/error false·blockedReason null. typecheck/lint 출력0, build1590/722bytes·관측 warning2, unit57986/0bytes다. 준비 npm도 정상·관측 warning2다.
- 실제07:25:51.685Z counters247/247/fail0/cancelled0/skipped0/todo0·FINAL_CHECK 후52.211Z 정확 COMPLETE를 독립 확인했다. 검토한 동일 controller의 엄격 종료·OS·정리 뒤에만 완료하는 조건은 유지됐다.
- 완료 source SHA-256은 `fb02e099edd8855db3934d6c7bc5a2094ed0e9d5b92fc16e265183b294d728bc`, package/lock은 위 후보 고정값이며 tests247다.

**최신07 후보 exact 오프라인 범위 GO / 운영전체 NO-GO.** 이 실행도 이전 후보247·기준232·native99에 더하지 않는다. 실제 수동06·브라우저/DB·audit·복원/rollback 게이트는 그대로 별도이며 과거 자동06 라벨을 소급해 바꿔 기록하지 않는다.

## 데이터 안전·잔여 위험

문서 작성 과정에는 DB/Storage/세션/편집 임대 접근·변경이 없다. CI 설계도 실제 DB/Storage·운영 비밀값을 제공하지 않는다. 새 업무/QA 행·사진을 만들거나 기존 성공 QA를 수정·삭제·초기화·seed하지 않는다. 자료가 없다는 이유로 기존 자료를 테스트 대상으로 가져오지 않는다. 스킬의 기본 테스트 자료 정리 안내보다 현재 사용자 보관 결정과 저장소 무삭제 경계를 우선한다.

준비의 일반 bridge 연결은 제한된 설치 예외이며, app의 망 차단과 혼동하지 않는다. 무스크립트 설치로 native 산출물이 부족하면 BLOCKED로 남긴다. install script를 켜거나 실환경 파일·키를 넣거나 online app/패키지 관리자 fallback으로 우회하지 않는다. 경고·stdout/stderr 요약은 해당 실행의 제한된 관찰값이고 취약점 부재·누수 부재를 입증하지 않는다.

**최종 결론: exact9485c79/run16 기준선25파일232/232와 별도 exactfbeec726/run41985974193 후보26파일247/247는 각각 엄격 종료·격리·소유 자원 정리까지 검증 완료다. 운영 전체는 여전히 NO-GO다.** 서로 다른 exactsource의 결과·native99·과거231을 더하지 않고 과거 실패도 보존한다. 이 성공들은 전체 P0·#91 실제 UI·#87/#66 의존성 보안/호환·실제 격리 통합·최신 독립 백업·새 복원 대상·exact fallback 호환 및 사용자 운영 승인을 대신하지 않는다. 운영/staging 배포·main merge·실제 SQL·과금/유료 전환·기존 데이터 변경은 이번 작업에 포함하지 않는다.
