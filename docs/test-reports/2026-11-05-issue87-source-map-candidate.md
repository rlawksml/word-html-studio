# #87 source-map-js 최소 보안 후보 검증

## 판정과 범위

- **후보 생성·파일 검증·앱 회귀 PASS / 운영 NO-GO**.
- 실제 보안 재audit는 외부 전송의 별도 승인 확인에서 **BLOCKED**되어 실행하지 않았다. 이전 high1 결과를 새 lock의 결과로 복사하거나, 수정 버전만 보고 취약점 0건으로 판단하지 않는다.
- 최신 제품 기준 `1eed9cb7752b9ade0091d9a9c5af6a72477f0cc9`의 #94 사진 보관 정책과 기존 27파일·277TC를 보존했다.
- 제품 검증 commit: `83fed460aa51ea62ef746ad1268c79da0fe53b92`, branch `codex/m1-source-map-security`.
- metadata 도구 commit: `661b6fba2512ca512b2d37f3299c2eea58e27a79`, branch `codex/m1-source-map-metadata`.
- 미실행 audit 준비 commit: `3fdb1d1b4159484c45182e77a285d5f827ef5d5e`, branch `codex/m1-source-map-audit`. 이 도구의 옛 앱 기준276을 최신 제품277 실행 증거로 쓰지 않는다.
- main merge·운영/Staging 배포·공유 SQL·기존 DB/Storage/QA·환경·유료 설정 변경 없음. 원래 dirty 작업 공간과 이전 checkpoint는 보존했다.

## 원인과 최소 변경

이전 [실제 audit](https://github.com/rlawksml/word-html-studio/actions/runs/42024099655)는 source-map-js1.2.1의 **high1 / FINDINGS**였다. [공식 GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q)는 1.2.2를 수정 버전으로 명시한다. 실제 서비스의 공격 도달성·장애·DB 손상을 확인한 것은 아니며, live DoS 재현은 하지 않았다.

공식 registry의 [1.2.2 공개 metadata](https://registry.npmjs.org/source-map-js/1.2.2)를 부모가 읽어 버전·tarball·SRI를 대조했다. 승인된 격리 resolver가 생성한 결과만 수신했고 SRI나 lock을 임의로 꾸며내지 않았다. [npm update](https://docs.npmjs.com/cli/v11/commands/npm-update/)의 기존 semver 범위 내 갱신을 사용했다.

- `package.json`: 기존과 바이트 단위 동일, 3,931B.
- `package-lock.json`: 394,737B, 735개 경로 동일. 추가0/삭제0/변경1/동일734.
- 유일한 raw diff: `node_modules/source-map-js`의 `version`, `resolved`, `integrity` 세 필드.1.2.1→1.2.2.
- scripts·직접 의존성·Next/React/vinext·기타 lock metadata·제품 코드·기존 테스트 불변.
- 제품의 나머지 변경은 새 LOCK_SHA256과 대응 검증 workflow pin뿐이다.

| 입력 | SHA-256 |
|---|---|
| package | `4b79c8d63413e685bbe8d04b199ff976c99c24b8257e9e66d5861f58e2eaf5e8` |
| 이전 lock | `bcd90db9e993e0dc5ec270cfe9efc141e783f3a7a5682236d33ce1a3dde029fe` |
| 새 lock | `68297e0d957b93e270b6d70473b990b680a23afb45f5fd1ad8d9559f8e19cada` |
| 제품 검증 baseline | `983c7c98dc2e8ddadd110324429e7f9ef3c1d4e7c4cd20b7275bb14e14df934d` |

## TC와 실제 결과

| 구분 | 실제 결과·증거 |
|---|---|
| META-01~29 | [최종29TC](https://github.com/rlawksml/word-html-studio/actions/runs/42030119834), exact661b6fb,29PASS/실패·취소·TC skip·todo0. 소유 정리12:47:50.0635271Z |
| 첫 정책 실행 | [run42029840696](https://github.com/rlawksml/word-html-studio/actions/runs/42029840696), exactdb0af50,29PASS. 이후 META29의 lock hash 분기 도달을 보강했으므로 최종 증거와 합산하지 않음 |
| 실제 resolver | [run42030352582/job127254979245](https://github.com/rlawksml/word-html-studio/actions/runs/42030352582/job/127254979245), exact661b6fb, npm lock-only exit0·signal null·limited/error false·관측 warning0 |
| 수신 검증 | archive digest·정확2개 일반 JSON·CRC/길이/파일 hash/UTF8/중복 key·새 private0700/파일0600·regular/nlink1·읽기 재검증 PASS. 범용 archive 추출/extractall 없이 허용된 두 항목만 제한 검증·저장했으며 받은 코드는 실행하지 않음 |
| 제품 typecheck/lint/build | [run42030911635/job127256881741](https://github.com/rlawksml/word-html-studio/actions/runs/42030911635/job/127256881741), exact83fed46,3단계 모두 exit0·signal null·limited/error false·blockedReason null |
| 제품 전체 unit | 같은 run, 기존27파일277PASS/실패·취소·TC skip·todo0,12:54:28.4622424Z |
| 최종 종료/정리 | 같은 run의 엄격 종료·실효 OS 검사·소유 리소스 정리 후12:54:29.0023251Z `OFFLINE_APP_COMPLETE` |
| 새 lock production audit | **BLOCKED / 미실행**. 자동 승인 검토에서 public graph·실행환경 metadata의 registry 전송에 대한 명시적 승인 부족으로 차단됨. 구체 payload/목적지에 대한 사용자 답변 대기. 우회·재시도하지 않음 |
| 실제 브라우저·DB/사진·fallback/복원 | 이번 패키지 검증에 포함하지 않음. 전체 운영 게이트에서는 여전히 BLOCKED |

최종 META 테스트 SHA는 `5dd1e316953348ecade3096d15062633c21b6b850c4b535127bf352283a31c53`이다. 기존 META12~24를 유지하고, 단일 target 외 변경/추가/삭제·root/scripts/directdeps·잘못된 canonical SRI·no-op·중첩 target·package byte 변경·원본 pin 오류를 거부한다. META29는 읽기 전용 공개 package fixture로 첫 hash를 통과한 뒤 잘못된 lock의 실제/기대 hash까지 확인한다. metadata 도구의 기존 offline276 기준은 그대로 두고 전용 입력 검증을 분리했다. 제품277 기준에는 승인된 새 lock hash와 대응 pin만 반영했다.

각 실행은 별도 목적이며29/277/기존27·30·25·276 등 서로 다른 실행 수를 합산하지 않는다. 일반 verify/legacy Supabase job의 SKIPPED는 TC 성공 수가 아니다.

## 실행·반출 안전 경계

metadata와 앱은 각각 검토한 native closure16개/10개를 고정했다. 공개 표준 Linux에서 runner의 기존 Node/npm만 FROM scratch로 복사하고 빈 allowlist 환경·비루트·RO root/source·소비자 단계 RO toolchain(준비 단계만 RW tmpfs)·CPU2/메모리·PID·파일·출력·시간 상한을 적용했다. 의존성 준비만 별도 bridge 예외를 사용했다. registry-only 방화벽이라고 표현하지 않는다.

resolver는 고정 `npm update source-map-js --package-lock-only --ignore-scripts --no-audit --no-fund`와 공식 registry·빈 npm config·scratch cache를 사용한다. network seal→RO 소비자→prep 제거 확인→nonce/hash/용량 제한 패킷→엄격 정리→private 승격→정확2파일 재확인 이후에만 업로드한다.

사용자는 이번 두 public JSON의 제한 전달을 새로 허용했다. 업로드 직전 무료 저장 범위를 확인했으며 계정/결제 수치는 공개 기록에 넣지 않았다. artifact는1개·내부 파일2개·84,387B,ID13415956872,archive SHA `4b3ec111aa71c2122c49a27bfeae8c08a791114ea1c98a730c6f3452b29eda42`,2026-11-06T12:49:43Z 만료다. 앱·키·DB·사진·원시 로그는 artifact에 없다.

실제 metadata는12:49:42.2955693Z SEAL→FINAL→정리 후12:49:43.5898187Z COMPLETE(`cleaned:true`,`files:2`,`audit:NOT_RUN`,`appValidation:NOT_RUN`)→12:49:43.6305240Z preupload PASS였다. 수신 파일은 별도 새 부모측 디렉터리에만 남겼다.

제품 검증은 별도의 무스크립트 `npm ci` 준비 뒤 network seal·RO 소비자 확인·prep 제거 후 direct Node의 typecheck→lint→vinext build→기존27파일 unit 순서다. 앱 실행에 외부망/키/DB 연결은 없다. 최종 source SHA `aa78ddf432bdd715d2fd28c392fbcd5e7a0eea793933febae0102f95d95eb36c`를 부모가 Git blob에서 독립 재계산해317파일/4,786,614B와 대조했다. 이 실행의 artifact는0개다.

## 경고·미완료

- npm prep 관측 warning2(stdout27/stderr166B), build 관측 warning2(stdout1590/stderr722B)는 별도 분류가 필요하다. raw text가 없어 경고 부재나 안전성을 일반화하지 않는다.
- unit stdout64,970B/stderr0, 공유64KiB cap 여유566B. 관측 warning 일치4개를 런타임 경고4건으로 단정하지 않는다(테스트 제목 포함 가능). 출력 요약 개선 전 상한 완화·TC 삭제·제목 축약을 하지 않는다.
- 새 audit는 아직 실행하지 않았고 기존 high1 해결 여부의 검사 결과를 확정하지 않는다. 승인 시 준비된 audit exact3fdb1d1의 public graph/실행환경 정보만 공식 registry에 보내 plain audit를 실행한다. 설치·fix·앱·키·DB·사진·artifact·배포는 하지 않는다.
- #66 vinext/React·개발 Miniflare/sharp, #93 경로/TOCTOU, 실제 P0/사진·동시 작업·통합본·#86 SQL, 최신 독립 백업·새 빈 대상 복원·호환 exact fallback은 별도다.
- 실제 운영 장애 확인·새 배포·복구 가능 확정이나 이슈 종료를 하지 않았다. 앱 롤백에도 최신 DB/사진을 유지한다.
