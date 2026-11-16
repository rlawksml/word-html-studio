# Supabase 무손실 백업·복구 Runbook

2026-11-05 #93: **새 목적지 백업 writer만** 보유 dirfd·nofollow·EXCL 경계로 분리했다. 고정 CLI14의 RED8FAIL→GREEN14PASS, 최종afbbf96의 protocol12/완전성30/복원정책25/앱277·type/lint/build·엄격 정리를 확인했다. [writer 검증 보고서](test-reports/2026-11-05-issue93-backup-writer.md)는 Linux 격리·합성 자료 범위이며 실제 백업/복원·Mac·운영 승인이 아니다. verifier/restore의 path 재읽기는 이번 수정 범위 밖이며 기존 백업 자체를 자동 이동/수정하지 않는다.

2026-11-05 #94 정책: 목록화된 모든 원본·미리보기 사진을 보관한다. 검증을 모두 통과한 미참조 사진은 고정 경고만 남기며, 참조 사진 누락·파일/해시·통계 오류는 계속 FAIL이다. verify 및 restore dry-run/최종 요약에 `warnings`가 전달된다. [파일 기반 검증 보고서](test-reports/2026-11-05-issue94-retained-photo-warnings.md)의30/25/277 PASS는 실복원·#93 경로 안전성·원자 snapshot·운영 승인이 아니다. 미참조 사진을 지워 통과시키거나 기존 백업 manifest를 고치지 않는다.

이 문서는 동네책방 소식 스튜디오의 Database와 사진을 안전하게 백업하고, **운영·현재 보관용 Staging과 다른 새 격리 프로젝트**에서 복원 가능성을 검증하는 절차입니다.

2026-11-05 준비 변경: marker의 component/version이 같고 적용 시각만 다른 경우, 대상 marker를 그대로 보존하는 계획/최종 검증을 추가했습니다. 아래 절차의 **소스 구현 단계**이며 실제 SQL 적용·복원 성공이나 실행 승인을 뜻하지 않습니다. 운영 `kdigttaghqubfjsmbngl`과 보관 Staging `kriyjyyudngtibrtkylf`는 복원 대상에서 하드 차단합니다.

2026-11-04 추가: 앱 긴급 롤백의 현재 실제 배포물·호환성·환경 보존과 준비 전용 검사기는 [운영 반영 전 롤백 준비](ROLLBACK_PREPARATION.md)를 따른다. 이 문서 아래의 과거 준비 과제는 당시 기준이며 기존 staging을 빈 환경으로 초기화하는 허가가 아니다. 이미 보관 중인 staging 자료를 삭제/재복원하지 않는다. 백업의 순차 SELECT/다운로드는 동시 쓰기 중 원자 snapshot을 보장하지 않으므로 운영 전 일관성 확인 방식을 별도로 확정한다.

## 절대 원칙

- 운영 Supabase에는 테스트 데이터를 만들거나 복원 명령을 실행하지 않습니다.
- 앱 롤백과 DB 복구는 별개의 판단입니다. 앱을 이전 버전으로 돌려도 DB는 그대로 둡니다.
- 운영 DB를 과거 백업으로 바로 덮어쓰지 않습니다. 별도 Staging에서 먼저 복원하고 검증합니다.
- 기존 migration 파일은 수정하지 않고 새 migration만 추가합니다.
- 테이블 `DROP`, 컬럼 삭제·이름 변경, Storage 자동 삭제는 검증된 복구 훈련 전까지 금지합니다.
- 백업 디렉터리와 압축 파일은 Git 저장소 밖에 두며 GitHub에 올리지 않습니다.
- `SUPABASE_SECRET_KEY`, 작업 암호, 세션 비밀값은 백업·보고서·Git에 넣지 않습니다.

## 제공 도구

| 명령 | 쓰기 여부 | 역할 |
|---|---:|---|
| `npm run backup:supabase -- /절대/백업/경로` | 운영에 쓰기 없음 | 테이블 SELECT, Storage 목록·다운로드, migration 복사, manifest 생성 |
| `npm run backup:verify -- /절대/백업/경로` | 없음 | 모든 DB JSON과 사진의 크기·SHA-256, 참조 관계 확인 |
| `npm run restore:staging -- /절대/백업/경로` | 대상 읽기만 | 별도 격리 대상·업무 테이블·marker·버킷을 사전 점검하는 dry-run |
| `npm run restore:staging -- /절대/백업/경로 --execute` | **승인된 격리 대상만 쓰기** | 업무 행·사진을 넣고 재검증. marker는 쓰지 않음 |

복원 도구에는 다음 다중 차단 장치가 있습니다.

1. `APP_ENV=staging`이 아니면 중단
2. URL의 실제 프로젝트 ref가 `EXPECTED_STAGING_PROJECT_REF`와 다르면 중단
3. 사람이 다시 입력한 `CONFIRM_STAGING_PROJECT_REF`와 다르면 중단
4. 운영/현재 보관용 Staging의 고정 ref이면 확인 변수가 같아도 중단
5. 백업 원본 fingerprint가 없거나 유효한 16자리 소문자 hex가 아니면 중단하고, 대상과 같아도 중단
6. 업무 테이블/버킷은 기본 빈 대상만 허용. `--resume`은 기존처럼 source 전체 해시가 같아야 허용
7. `app_schema_versions`는 source/target의 component 집합·version이 정확히 같아야 하며 대상 marker를 삽입·수정·삭제하지 않음
8. marker가 비었거나 추가/누락 component·상하위 version·잘못된 값·알 수 없는 행 필드가 있으면 중단
9. backup manifest 또는 파일 해시가 다르면 중단

대상 URL은 HTTPS 공식 프로젝트 root URL만 허용합니다. 사용자 정보·임의 port·경로·query·fragment로 대상을 변형하지 않습니다. 이 검사는 실제 schema/권한/프로젝트 소유권을 증명하지 않으며, 16자리 fingerprint도 신원 인증 수단이 아니라 실수 방지 식별자입니다.

이 장치가 있어도 실행 전 Supabase 대시보드의 프로젝트 이름과 ref를 사람이 다시 확인합니다.

## 1. 운영 백업 만들기

### writer 실행 요건 — 실제 작업 전 별도 확인

- 웹앱/Cloudflare가 아닌 수동 백업 CLI만 POSIX와 고정 `/usr/bin/python3`를 요구한다. Linux만 실증했으며 Mac은 미검증이다. 미지원 시 일반 path 쓰기로 우회하지 않는다.
- 목적지의 부모는 이미 존재하고 조상에 symlink나 group/other 쓰기 권한이 없어야 한다. 새 root만0700, 파일0600으로 만들며 부모 자동 생성·기존 목적지·기존 백업 안 새 쓰기는 거부한다.
- 새 writer 상한: 파일64MiB/총4GiB/파일10,000/디렉터리10,000/상대깊이16/절대조상깊이64/header8KiB/대기payload64MiB/전체15분/ACK30초. 웹서비스 사진 업로드 제한을 변경하는 것은 아니다. 실제 백업 전 자료 크기와 요건을 확인한다.
- 상한 초과·중간 실패는 잘라 저장하거나 자동 삭제하지 않는다. 초기화 이후의 부분 자료와 INCOMPLETE를 보관한다. commit 이후 ACK 유실은 UNKNOWN으로 완료 판정을 보류하고 자료 삭제·marker 재생성을 하지 않는다.
- 악성 동일 UID/root의 임의 reparenting까지 방어한다고 보장하지 않는다. 실제 백업은 승인된 프로젝트와 새 private 경로에서만 실행하고 순차 SELECT의 snapshot 일관성을 별도로 확인한다.

### 읽기 일관성 확인

- 실제 프로젝트와 실행을 승인한 담당자가 백업 동안 입력·HTML 편집·DB/Storage 작업이 없는 시간대를 확인합니다. 아래 `confirmed`는 그 확인의 기록이지 서비스의 쓰기를 잠그는 기능이 아닙니다. 데스크톱 경로가 iCloud 등 외부 동기화 대상이 아니며 기존 백업을 덮어쓰지 않는 새 비공개 목적지인지도 별도로 확인합니다.
- CLI는 HTTPS 공식 프로젝트 root와 지정한 ref가 다르면 접속하지 않습니다. 먼저 편집 임대를 읽고 활성 임대(만료 직후 1분 포함)나 해석 불가 임대가 있으면 중단합니다. 테이블은 최대 100,000행, Storage 목록은 파일/폴더 합계 10,000항목으로 제한되며 한도를 넘기면 조용히 자르지 않습니다.
- DB 행·schema capability와 Storage bucket/object 목록을 다시 읽어 비교합니다. 객체 ID·생성/수정 시간·크기·eTag를 비교하고 다운로드 실제 크기도 확인합니다. 다운로드로 바뀔 수 있는 접근 시간은 비교에서 제외합니다. 메타데이터가 없거나 값이 다르거나 최종 임대가 바뀌면 완료 manifest를 만들지 않습니다.
- SDK는 다운로드 응답을 먼저 메모리에 담습니다. 최초 목록에서 64MiB를 넘는 객체는 받지 않으며, 내려받은 Blob의 크기가 달라지면 복사·저장을 시작하지 않습니다. 현재 migration의 버킷 상한은 원본/legacy 20MiB, 미리보기 5MiB입니다. 실행 전 실제 버킷 설정을 별도로 확인하며 다운로드 동안 원격 제한까지 변경되는 경우의 메모리 상한을 보장하지 않습니다.
- 순차 읽기는 **원자적 스냅샷이 아닙니다**. 변경 후 다시 원복된 값, 임대를 쓰지 않는 작업, 읽기 사이에 발생한 변경을 모두 발견한다고 보장하지 않습니다. 편집 중지 시간대가 확인되지 않거나 결과가 `COMPLETE`가 아니면 복원 근거로 쓰지 않습니다. 새 부분 사본과 `INCOMPLETE`는 자동 삭제하지 않습니다.

운영 비밀값은 Git에 포함되지 않는 `apps/web/.env.production.local` 같은 로컬 파일에만 둡니다.

```bash
cd apps/web
BACKUP_SOURCE_TAG=v1.0.0 \
BACKUP_SOURCE_COMMIT=<배포-커밋-SHA> \
BACKUP_EXPECTED_SOURCE_PROJECT_REF=<운영-프로젝트-ref> \
BACKUP_CONFIRM_IDLE_WINDOW=confirmed \
node --env-file=.env.production.local scripts/supabase-backup.mjs \
  /사용자/지정/저장소/bookstore-news-YYYYMMDD-HHMMSS
```

백업 대상은 새 디렉터리여야 하고 현재 실행 저장소 내부이면 거부합니다. 다른 Git 저장소를 자동 탐색하는 도구는 아니므로 목적지는 모든 Git 저장소 밖의 전용 폴더로 확인합니다. INCOMPLETE는 이번 세션이 만든 고정 marker만 제거하며, 파일·manifest·ledger 검증과 EOF 봉인 후 helper의 완료 ACK와 정상 종료까지 확인해야 CLI가 COMPLETE를 출력합니다. COMPLETE가 없으면 원본을 고치거나 지우지 말고 별도 검증으로 확인합니다.

백업 범위는 다음과 같습니다.

- 기존 스키마: `bookstores`, `submissions`, `editing_leases`, `improvement_requests`
- `202609070001` 이후: `app_schema_versions`, `news_schedule_ranges`도 자동 포함
- `bookstore-news`, `bookstore-news-originals`, `bookstore-news-previews`의 모든 객체
- DB 사진 경로와 Storage 객체의 누락·고립 여부
- 당시 저장소에 있는 Supabase migration SQL (실제 적용 목록으로 간주하지 않음)
- 코드 tag·commit과 프로젝트 URL의 비가역 fingerprint

## 2. 백업 파일 검증·보관

```bash
cd apps/web
npm run backup:verify -- /절대/백업/경로
```

`PASS`와 검증 파일 수·바이트 수·manifest SHA-256을 릴리스 보고서에 기록합니다. 그다음 백업 디렉터리를 압축하고 압축 파일 자체의 SHA-256도 기록합니다.

```bash
tar -czf bookstore-news-YYYYMMDD-HHMMSS.tar.gz bookstore-news-YYYYMMDD-HHMMSS
shasum -a 256 bookstore-news-YYYYMMDD-HHMMSS.tar.gz
```

현재 1차 백업은 같은 Mac의 저장소 밖에 보관되어 있습니다. 이는 실수·코드 배포에 대한 복귀 지점이지만 기기 고장까지 대비하는 독립 백업은 아닙니다. Staging 복원 성공 후 암호화된 외부 보관 위치와 보존 주기를 확정합니다.

## 3. 승인된 별도 복원 대상 준비

1. 별도 승인 후 운영·보관 Staging과 다른 새 프로젝트를 준비합니다. 예: `bookstore-news-studio-restore-check`. 현재 Staging을 비우거나 재사용하지 않습니다. 유료 전환/새 비용은 별도 승인 없이 하지 않습니다.
2. 가능하면 운영과 같은 region을 선택합니다.
3. source의 실제 marker와 일치하는 검토된 migration 범위로 대상을 준비합니다. 백업은 로컬 SQL 전부를 복사할 수 있으므로, **포함된 모든 SQL을 자동 적용하지 않습니다.** 원본 marker/백업 파일을 target에 맞추려고 수정하지 않습니다.
4. 원본 버킷은 Private, 미리보기 버킷은 Public인지 확인합니다.
5. 별도 복원 대상 전용 URL·Secret Key는 Git에 포함되지 않는 별도 환경파일에 사용자가 입력합니다. 기존 `.env.staging.local`이나 현재 Worker 설정을 바꾸지 않습니다.
6. target marker에 추가 component나 다른 version이 있으면 자동 조정하지 않고 BLOCKED로 남깁니다. source에 marker가 없는 legacy 백업은 목록을 그대로 유지하되 실제 schema 동등성은 별도로 미검증입니다.

복원 도구는 실제 DDL 동등성이나 외부 writer 부재를 보장하지 않습니다. 승인된 독립 대상에서 migration·앱·다른 복원 작업의 동시 쓰기를 차단한 뒤에만 훈련합니다. preflight/최초 insert 전/최종 marker 검증 사이에도 원자적인 전체 복원을 제공하지 않습니다.

현재 migration의 `replace_bookstore_news_workspace(jsonb)` 함수는 전체 교체 방식의 과거 호환 함수이며 현재 앱은 호출하지 않습니다. 삭제 로직을 포함하므로 Production 권한 변경은 별도 additive migration과 Staging 검증을 거친 뒤 진행합니다.

## 4. Staging 복원 dry-run

아래 두 ref 환경변수에는 같은 **Staging 프로젝트 ref**를 사람이 각각 입력합니다.

```bash
cd apps/web
APP_ENV=staging \
EXPECTED_STAGING_PROJECT_REF=<staging-project-ref> \
CONFIRM_STAGING_PROJECT_REF=<staging-project-ref> \
node --env-file=.env.restore-check.local scripts/supabase-restore-staging.mjs \
  /절대/백업/경로
```

`DRY_RUN_PASS`가 표시되고 다음 항목이 맞아야 합니다.

- 대상 fingerprint가 backup source fingerprint와 다름
- 업무 테이블은 기존 행 수0(또는 `--resume` exact 일치)
- marker가 있다면 `schemaMarkerPolicy.action=preserve`이며 component/version 동등. 대상 `applied_at`은 source와 달라도 보존
- 세 Storage 버킷이 존재하고 공개/비공개 설정이 맞음
- 복원 예정 행·사진 수가 manifest와 일치

## 5. Staging 복원 실행과 확인

dry-run 결과를 기록한 뒤 같은 명령 마지막에 `--execute`를 붙입니다.

```bash
APP_ENV=staging \
EXPECTED_STAGING_PROJECT_REF=<staging-project-ref> \
CONFIRM_STAGING_PROJECT_REF=<staging-project-ref> \
node --env-file=.env.restore-check.local scripts/supabase-restore-staging.mjs \
  /절대/백업/경로 --execute
```

도구는 기존 업무 데이터를 덮어쓰지 않고 검증된 계획의 업무 행만 `insert`, 사진은 `upsert: false`로 업로드합니다. **marker는 계획이 잘못되어 행을 포함하더라도 insert loop에서 제외합니다.** 최초 업무 쓰기 전과 실행 후 대상 marker를 다시 읽습니다.

최종 업무 행은 source JSON 해시, 사진은 크기·SHA-256을 확인합니다. marker는 source/target의 component/version 동등성과 **preflight target 전체 행 해시 불변**을 함께 확인하며 결과를 `schemaMarkerVerification`으로 구분합니다. target `applied_at`을 source 값으로 덮어써서 byte equality를 만들지 않습니다. 따라서 모든 테이블이 source와 byte-identical하다고 보고하지 않습니다. legacy 백업의 `schemaCompatibility=NOT_VERIFIED`도 성공한 schema 검증으로 해석하면 안 됩니다. `RESTORE_PASS`만으로 실제 앱 호환성/릴리스 GO가 확정되는 것은 아닙니다.

네트워크 오류로 복원이 중간에 멈췄다면 Staging 데이터를 바로 삭제하지 않습니다. 먼저 `--resume` dry-run으로 기존 행과 사진이 백업의 정확한 일부인지 확인합니다. 알 수 없는 객체, 일부만 들어간 테이블, 해시가 다른 행·사진이 하나라도 있으면 재개를 거부합니다.

```bash
APP_ENV=staging \
EXPECTED_STAGING_PROJECT_REF=<staging-project-ref> \
CONFIRM_STAGING_PROJECT_REF=<staging-project-ref> \
node --env-file=.env.restore-check.local scripts/supabase-restore-staging.mjs \
  /절대/백업/경로 --resume
```

`RESUME_DRY_RUN_PASS`에서 기존·누락 사진 수가 맞으면 마지막에 `--execute --resume`을 붙입니다. 이미 존재하는 사진은 네트워크 오류에 최대 6회 재시도하며 다시 내려받아 SHA-256이 일치할 때만 건너뛰고, 누락 사진은 최대 3회 재시도해 올립니다. 응답이 유실됐지만 업로드가 완료된 경우에도 원격 파일 해시를 확인해 중복 업로드 없이 이어갑니다.

복원 중간에 실패해도 일부 데이터를 임의로 고치거나 삭제해 재사용하지 않습니다. 원인과 부분 반영 범위를 기록하고, 별도 승인된 새 복원 전용 대상에서 다시 훈련합니다. 현재 운영/보관 Staging의 초기화는 이 절차에 포함되지 않습니다.

## 6. 복구 훈련 완료 기준

- 업무 테이블별 행 수와 JSON fingerprint가 backup manifest와 같음
- marker는 source와 component/version이 같고 preflight target 전체 행 해시 불변. 실제 DDL/legacy 호환성 검증은 별도
- 원본·미리보기 객체 수, 바이트 수와 SHA-256이 같음
- DB가 참조하는 사진 누락 0. 미참조 사진도 모두 보관하고 검증 통과 후 경고로 구분하며 삭제하지 않음
- 원본 버킷은 공개 URL로 직접 열리지 않음
- 공개 미리보기는 방문자 화면에서 표시됨
- v1.0.x와 v1.1 후보 앱이 같은 Staging 데이터를 읽을 수 있음
- 복구 소요 시간과 작업자를 포함한 테스트 보고서가 남음

## 7. 운영 장애 Runbook

1. 신규 기능 플래그를 끕니다.
2. 데이터 불일치 가능성이 있으면 입력자 쓰기 기능을 일시 중지합니다.
3. 장애 시점의 현재 운영 DB와 Storage를 **추가 백업**합니다.
4. 사고 시각, 영향 책방·월, 마지막 정상 저장 시각을 기록합니다.
5. 앱 문제이면 사전에 검증해 기록한 활성 fallback 배포의 **정확한 불변 배포 ID와 artifact SHA-256**을 대조한 뒤 해당 배포로 앱만 롤백합니다. Git tag 단독으로 대체하거나 tag만 믿고 재빌드해 롤백하지 않습니다.
6. DB migration은 되돌리지 않고 신규 필드와 v1.1 입력을 보존합니다.
7. 레코드 수·대표 Submission fingerprint·사진 참조를 읽기 전용으로 확인합니다.
8. DB 자체 손상이 의심될 때만 별도 Staging에 사고 직전 백업을 복원합니다.
9. 복원 결과를 검증한 뒤 필요한 레코드만 운영에 복구하는 별도 계획을 승인받습니다.
10. 운영 정상화 후 원인·복구 시간·재발 방지 조치를 보고서와 GitHub 이슈에 남깁니다.

## 아직 남은 일

- 별도 복원 전용 프로젝트와 source marker에 맞는 schema 준비 승인
- 1차 운영 백업의 실제 Staging 복원 훈련
- 앱 v1.0.1 ↔ v1.1 미래 JSON·기간 일정 왕복 호환 테스트
- 독립 장치 또는 암호화 원격 저장소에 두 번째 백업 보관
- 사용 요금제의 자동 백업/PITR 제공 범위 확인과 보존 주기 확정
- 월별 HTML·사진 ZIP 업무 백업 자동화
