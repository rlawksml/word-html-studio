# #93 백업 writer 경로 안전장치 검증

## 판정과 범위

- 단계: 운영 반영 전, 무료 공개 Linux OS 격리 검증. 배포 없음.
- writer 구현·고정 CLI14·추가 protocol12·앱 회귀: **GO**.
- 전체 운영: **NO-GO**. 실제 백업·복원, 현재 후보의 브라우저/DB P0와 exact fallback 호환 검증을 대신하지 않는다.
- 브랜치: `codex/m1-backup-writer-paths`, 기준 `98e5421fc17a43657141383f6ea8cd67ed54fd91`.
- 1차 제품 검증점: `692d34f932a43e46dbaae01eee903d7cdb9dd1f1`. 최종 테스트/profile 포함 검증점: `afbbf964333c022ec463eff93555dfef44fb46f6`.
- 원래 작업 폴더·기존 백업·운영/보관 Staging DB·Storage·사진·성공 QA에 접근하거나 변경하지 않았다.

## 원인과 최소 수정

기존 CLI는 목적지의 경로 문자열만 검사한 뒤 `stat → mkdir → writeFile`을 실행했다. 부모 링크가 저장소 안을 가리키거나 검사 이후 부모가 교체되면 다른 위치에 쓰고, 기존 leaf 파일은 덮어쓸 수 있었다. 실제 사용자 자료의 유출을 확인한 것이 아니라, 새 격리 fixture에서 가짜 저장소 sentinel의 바이트 변경을 재현한 것이다.

출력 쓰기만 `backup-writer-client.mjs`와 stdlib 전용 `backup-dirfd-writer.py`로 분리했다. SDK의 읽기·pagination·manifest/#94 보관 정책은 유지한다.

- 기존의 안전한 부모 아래 **새 전용 root**만 배타적으로 만들고 root0700·파일0600을 적용한다. 부모 자동 생성, 기존 목적지 재사용, 기존 백업 조상은 거부한다.
- 보유 dirfd 기준 nofollow·EXCL 쓰기와 source/목적지 identity 검사를 사용한다. 원문 백업이나 외부 파일을 고치거나 삭제하지 않는다.
- Node는 고정 `/usr/bin/python3 -I -S -B`를 빈 환경으로 한 번 실행한다. 키·SDK·네트워크는 helper에 전달하지 않는다.
- PUT을 직렬화하고 원래 header 바이트 ledger·파일 SHA/정체성을 확인한다. FINISH는 EOF 봉인→완료 ACK→정상 exit/close 순서가 모두 맞아야 CLI `COMPLETE`를 출력한다.
- 오류 시 이번 부분 출력도 자동 삭제하지 않는다. 완료 commit 뒤 ACK 유실은 UNKNOWN/실패로 보류하며 자료를 지우거나 marker를 다시 만들지 않는다.

## 고정 CLI14 RED → GREEN

- [수정 전 RED](https://github.com/rlawksml/word-html-studio/actions/runs/42040914607): exact `75fd835f526b0b386c9acddda881521c9ab5a8d7`, 6PASS/8FAIL, exit1.
- [수정 후 GREEN](https://github.com/rlawksml/word-html-studio/actions/runs/42042590405): exact `692d34f932a43e46dbaae01eee903d7cdb9dd1f1`, 14PASS/0FAIL.
- 두 실행 모두 취소/skip/todo0·격리 preflight·소유 container 정리를 확인했다.
- 같은 테스트 SHA `d03ef6afa59830f1d5f1214f1d26417a6c980f0ba5f935c29e6d92bc67a93955`, fixture SHA `a06f76f035bfa99b9ec137b1d47e000c10bb5353353c4a0f3b4286389da2a549`.

| TC — 모두 P0 | 재현/검증 내용 | RED | GREEN |
|---|---|---|---|
| BACKUP-PATH-01 | 실제 CLI·가짜 SDK, UTF8/바이너리와 실제 manifest 검증기 | PASS | PASS |
| 02 | 기존 목적지 디렉터리와 sentinel 보존 | PASS | PASS |
| 03 | 기존 목적지 파일 보존 | PASS | PASS |
| 04 | 저장소 안 목적지 거부·SDK 미호출 | PASS | PASS |
| 05 | 조상 symlink로 가짜 저장소 쓰기 금지 | FAIL | PASS |
| 06 | world-writable 부모 거부 | FAIL | PASS |
| 07 | group-writable 부모 거부 | FAIL | PASS |
| 08 | 없는 부모를 재귀 생성하지 않고 거부 | FAIL | PASS |
| 09 | 초기화 뒤 부모 교체, 외부 sentinel SHA 보존 | FAIL | PASS |
| 10 | 미리 만들어진 payload 충돌, 덮어쓰기 금지 | FAIL | PASS |
| 11 | hardlink 외부 파일 바이트 보존 | FAIL | PASS |
| 12 | FIFO에 쓰지 않고 거부 | FAIL | PASS |
| 13 | SDK 합성 실패 시 미완료 자료 보존 | PASS | PASS |
| 14 | 가짜 키 누락 시 SDK/목적지 생성 전 거부 | PASS | PASS |

TC06/07의 고정 assert는 INCOMPLETE 미생성과 SDK 미호출을 검사한다. 빈 root만 생성한 뒤 거부하는 모든 구현까지 탐지하는 검사는 아니다. 외부 snapshot은 경로·type·mode·nlink·파일 크기/hash·link target을 비교하며 atime/ctime/inode 전체 불변을 증명하지 않는다. TC09는 sentinel hash 검사를 exit 검사보다 먼저 수행한다.

## 별도 protocol12

`tests/backup-writer-protocol.test.mjs`와 별도 fixture의 정확12개를 [최종 실행](https://github.com/rlawksml/word-html-studio/actions/runs/42044966337)했다. 최종 exact `afbbf964333c022ec463eff93555dfef44fb46f6`에서 **12PASS/0FAIL/취소·skip·todo0**, `14:26:34.8058697Z` 소유 정리를 확인했다. 기존 CLI14/앱277에 합치지 않는다. 실행 전 root가 TC03에 기존 백업 부모 보존 matrix를 보강한 뒤 동결했다. 최종 test SHA `58d3eb30549155dd6e08715294333136993f5b378b331db573cf76668059c4b4`, fixture SHA `d1148dc63fea8b50a648c03a35ac2d1c44d1e02e5355201e95d7e74fe44dfc62`다.

| TC — 모두 P0 | 범위 | 상태 |
|---|---|---|
| BACKUP-PROTO-01 | 실제 client/server, UTF8·binary·0byte·선택 table, 원래 header ledger | PASS |
| 02 | 중복 PUT·최초 파일 보존 | PASS |
| 03 | 경로 침범·상대 깊이·기존 백업 조상 거부/보존 | PASS |
| 04 | payload 중간 EOF | PASS |
| 05 | SHA 불일치 | PASS |
| 06 | marker 새 inode/링크 교체와 대체 항목 보존 | PASS |
| 07 | subdir 교체 뒤 외부 바이트 보존 | PASS |
| 08 | header/파일 선언/ACK 상한 | PASS |
| 09 | 필수 파일·ledger/count 위조·재직렬화 ledger | PASS |
| 10 | 완료 뒤 재PUT/재FINISH·trailing 입력 | PASS |
| 11 | idle/pending 취소·소유 process 종료 | PASS |
| 12 | 동시 PUT snapshot·직렬화·queue 뒤 FINISH | PASS |

정상/동시 client와 raw protocol은 실제 제품 소스를 실행한다. ACK 과대와 pending 취소만 명시적 합성 Python peer로 실제 Node client를 검사하며, 이를 실제 Python writer의 파일 검증으로 세지 않는다.

## 기존 회귀 — 같은 제품 코드, 서로 합산하지 않음

| 실행 | 실제 결과 |
|---|---|
| [completeness30](https://github.com/rlawksml/word-html-studio/actions/runs/42042726171) | 30PASS, 나머지0·소유 정리 |
| [restore정책25](https://github.com/rlawksml/word-html-studio/actions/runs/42042738869) | 25PASS, 나머지0·소유 정리. 실제 복원 아님 |
| [앱 전체](https://github.com/rlawksml/word-html-studio/actions/runs/42042714709) | type/lint/build·기존27파일277PASS, 나머지0·엄격 정리 후 COMPLETE |

앱 COMPLETE는 `2026-11-05T14:13:43.1909274Z`, source SHA `70cb53509f86df5d0a1a7989cfcff1a62c4697e15222e58364dab287e6d75129`다. package `4b79c8d63413e685bbe8d04b199ff976c99c24b8257e9e66d5861f58e2eaf5e8`, lock `68297e0d957b93e270b6d70473b990b680a23afb45f5fd1ad8d9559f8e19cada`는 불변이며 새 audit·설치 자동수정은 하지 않았다. 독립 Astra가 네 run의 exact/attempt1/success와 실제 고정 marker를 대조했다.

unit stdout64,979B·stderr0, 공유64KiB까지557B 여유다. 상한 완화·TC 제거·제목 축약은 하지 않았다. npm 준비/build의 warning 단어 관측 각2·unit4는 원문 분류를 하지 않았으며 실제 경고 수로 단정하지 않는다.

### 최종 동일 커밋 병렬 재검증

테스트/profile 변경만 추가한 `afbbf964333c022ec463eff93555dfef44fb46f6`에서 다섯 실행을 모두 다시 확인했다. 제품3파일·고정14TC/fixture·package/lock은 `692d34f`와 byte-identical이다. 아래 suite는 겹치는 범위가 있으므로 PASS 수를 합산하지 않는다. 모든 행의 FAIL/BLOCKED/TC-SKIPPED/취소/todo는0이다.

| suite / 실행 | PASS | 실패 | 차단 | TC 제외 | 정리 후 성공 증거(UTC) |
|---|---:|---:|---:|---:|---|
| [protocol](https://github.com/rlawksml/word-html-studio/actions/runs/42044966337) | 12 | 0 | 0 | 0 | 14:26:34.8058697Z |
| [CLI 경로](https://github.com/rlawksml/word-html-studio/actions/runs/42044981314) | 14 | 0 | 0 | 0 | 14:26:40.3282295Z |
| [백업 완전성](https://github.com/rlawksml/word-html-studio/actions/runs/42044998681) | 30 | 0 | 0 | 0 | 14:26:39.8596931Z |
| [복원 정책](https://github.com/rlawksml/word-html-studio/actions/runs/42045009750) | 25 | 0 | 0 | 0 | 14:26:44.5323833Z |
| [앱 전체+type/lint/build](https://github.com/rlawksml/word-html-studio/actions/runs/42045022478) | 277 | 0 | 0 | 0 | 엄격 정리 후 COMPLETE14:27:31.9329173Z |

최종 source SHA `b2eefeb9b614d8e4ecc7313a9bb35357656a793c9bc21f6f1a1aa1cc2168c377`, 입력 package/lock hash는 위와 같다. unit stdout64,973B·stderr0·공유 cap 여유563B이며 warning 단어 관측은 동일하다. protocol/앱 artifact 개수0도 API에서 확인했다. 제품/Astra 소스 검토 및 protocol 독립 소스 검토를 거쳤고, 실제 최종5run의 exact·카운터·정리·COMPLETE·입력 해시와 문서를 주 담당 및 독립 리뷰 담당이 각각 대조했다. protocol 단계의 Astra 용량 부족에는 별도 독립 release reviewer로 대체했으며 실제 실행 증거 기준은 유지했다.

## 실행 경계와 준비 실패 이력

`ci.yml` 수동 `validation_mode=source_policy`의 `backup_paths`/`backup_protocol`은 exact codex feature commit만 허용한다. FROM scratch, 외부망 없음, 원본 source/runtime RO, UID/GID65534, cap0/NNP/seccomp, 256MiB·CPU1·PID32·FD128·파일8MiB·scratch16MiB·45초 container/30초 test·공유64KiB를 확인한다. backup 전용 scratch0700·OOM0·후손 process 부재 검사도 적용한다. 바이트를 대조한 테스트용 source 사본은 소유 scratch에서 실행한다. 실제 CLI fixture는 SDK만 대체하며 4초/32KiB, protocol fixture는 6초/32KiB·빈 환경·자기 process group 종료를 확인한 뒤 자신이 만든 자료만 정리한다.

검토된 부모 assembler는 신뢰된 OS Python/필요 stdlib만 읽기 복사한다. 호스트에서 앱·fixture·Python 소스를 실행하거나 pip/새 OS 패키지를 설치하지 않는다. 실제 RED에서 Python3.14·615파일/34,714,654B 복사를 확인했다. 앱 의존성 준비는 별도 기존 승인된 ignore-scripts/no-audit 단계이고, 실제 검증은 망 차단 뒤 수행한다.

RED 전 [42039066727](https://github.com/rlawksml/word-html-studio/actions/runs/42039066727), [42039383717](https://github.com/rlawksml/word-html-studio/actions/runs/42039383717), [42040093747](https://github.com/rlawksml/word-html-studio/actions/runs/42040093747), [42040510408](https://github.com/rlawksml/word-html-studio/actions/runs/42040510408)는 **런타임 준비 BLOCKED**였고 제품 TC를 실행하지 않았다. 경로 허용을 넓히지 않고 불필요 build/site customization을 제외했으며, 신뢰된 ELF의 정확한 무의존성 `ldd` 한 줄만 구분했다. 원문 OS 경로나 오류 대신 고정 enum/줄 번호만 출력했다. 이 실패들을 제품 RED나 운영 장애로 세지 않는다.

## 운영 요건·미검증 범위

- POSIX·고정 `/usr/bin/python3`가 필요한 **백업 CLI 전용** 변경이다. 웹앱/Cloudflare Worker에 Python을 요구하지 않는다. Linux 실증이지 Mac 검증이 아니며 미지원 시 일반 경로 쓰기로 fallback하지 않는다.
- 새 writer 상한: 파일64MiB/총4GiB/파일10,000/디렉터리10,000/상대깊이16/절대 조상깊이64/header8KiB/대기payload64MiB/전체15분/ACK30초. 상한을 넘겨 잘라 저장하지 않는다. SDK의 기존 전체 행·단일 blob 메모리 수집 동작까지 bounded라고 주장하지 않는다.
- 실제 최대4GiB·10,000파일·15분의 정상 경계를 실행한 것은 아니다. 미실행 상한·Mac·실제 SDK/DB/Storage·동시 쓰기 snapshot·실복원은 이 범위에서 SKIPPED이며 운영 준비 증거로 대체할 수 없다.
- 악성 동일 UID/root가 열린 디렉터리를 임의로 reparent하는 상황이나 marker stat→unlink의 모든 동일 권한 공격을 원자적으로 방어한다고 보장하지 않는다.
- 저장소 containment 검사는 현재 실행 source root identity를 기준으로 한다. 다른 Git 저장소를 자동 탐색하는 도구는 아니므로 실제 백업 목적지는 모든 Git 저장소 밖의 전용 폴더로 별도 확인한다.
- verifier/restore의 path 재읽기는 이번 writer-only 범위 밖이다. 이것만으로 별도 취약점을 확정하거나 새로운 필수 릴리스 게이트를 자동 추가하지 않는다. 실제 복원은 승인된 private 경로·현재 별도 Runbook을 따라 독립 검증한다.
- 기존 실제 자료·DB·Storage·사진·QA·백업·환경·과금 변경0. main merge·PR생성·Staging/운영 배포·SQL 없음. 테스트가 만든 가짜 scratch 자료만 소유 종료 확인 뒤 제거한다.
