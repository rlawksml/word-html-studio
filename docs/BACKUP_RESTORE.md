# Supabase 무손실 백업·복구 Runbook

이 문서는 동네책방 소식 스튜디오의 Database와 사진을 안전하게 백업하고, **운영이 아닌 별도 Staging 프로젝트**에서 복원 가능성을 검증하는 절차입니다.

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
| `npm run restore:staging -- /절대/백업/경로` | 대상 읽기만 | Staging 주소·빈 테이블·버킷 설정을 사전 점검하는 dry-run |
| `npm run restore:staging -- /절대/백업/경로 --execute` | **Staging만 쓰기** | 빈 Staging에 행·사진을 넣고 다시 내려받아 해시 검증 |

복원 도구에는 다음 다중 차단 장치가 있습니다.

1. `APP_ENV=staging`이 아니면 중단
2. URL의 실제 프로젝트 ref가 `EXPECTED_STAGING_PROJECT_REF`와 다르면 중단
3. 사람이 다시 입력한 `CONFIRM_STAGING_PROJECT_REF`와 다르면 중단
4. 백업의 원본 프로젝트 fingerprint와 대상 fingerprint가 같으면 중단
5. 대상 테이블이나 버킷에 데이터가 하나라도 있으면 `--execute` 중단
6. backup manifest 또는 파일 해시가 다르면 중단

이 장치가 있어도 실행 전 Supabase 대시보드의 프로젝트 이름과 ref를 사람이 다시 확인합니다.

## 1. 운영 백업 만들기

운영 비밀값은 Git에 포함되지 않는 `apps/web/.env.production.local` 같은 로컬 파일에만 둡니다.

```bash
cd apps/web
BACKUP_SOURCE_TAG=v1.0.0 \
BACKUP_SOURCE_COMMIT=<배포-커밋-SHA> \
node --env-file=.env.production.local scripts/supabase-backup.mjs \
  /사용자/지정/저장소/bookstore-news-YYYYMMDD-HHMMSS
```

백업 대상 경로는 새 디렉터리여야 하고 저장소 내부이면 도구가 거부합니다. 작업 중에는 `INCOMPLETE` 파일이 존재하며, 모든 파일과 manifest 기록이 끝나야 이 표시가 제거됩니다.

백업 범위는 다음과 같습니다.

- `bookstores`, `submissions`, `editing_leases`, `improvement_requests`
- `bookstore-news`, `bookstore-news-originals`, `bookstore-news-previews`의 모든 객체
- DB 사진 경로와 Storage 객체의 누락·고립 여부
- 당시 저장소의 Supabase migration SQL
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

## 3. 별도 Supabase Staging 준비

1. 운영과 이름이 분명히 다른 새 프로젝트를 만듭니다. 권장 이름은 `bookstore-news-studio-staging`입니다.
2. 가능하면 운영과 같은 region을 선택합니다.
3. SQL Editor에서 `apps/web/supabase/migrations`의 파일을 파일명 순서대로 적용합니다.
4. 원본 버킷은 Private, 미리보기 버킷은 Public인지 확인합니다.
5. Staging 전용 URL·Secret Key를 Git에 포함되지 않는 `.env.staging.local`에 저장합니다.
6. GitHub `staging` Environment에도 **Staging 값만** 등록합니다. Production 값을 복사하지 않습니다.

현재 migration의 `replace_bookstore_news_workspace(jsonb)` 함수는 전체 교체 방식의 과거 호환 함수이며 현재 앱은 호출하지 않습니다. 삭제 로직을 포함하므로 Production 권한 변경은 별도 additive migration과 Staging 검증을 거친 뒤 진행합니다.

## 4. Staging 복원 dry-run

아래 두 ref 환경변수에는 같은 **Staging 프로젝트 ref**를 사람이 각각 입력합니다.

```bash
cd apps/web
APP_ENV=staging \
EXPECTED_STAGING_PROJECT_REF=<staging-project-ref> \
CONFIRM_STAGING_PROJECT_REF=<staging-project-ref> \
node --env-file=.env.staging.local scripts/supabase-restore-staging.mjs \
  /절대/백업/경로
```

`DRY_RUN_PASS`가 표시되고 다음 항목이 맞아야 합니다.

- 대상 fingerprint가 backup source fingerprint와 다름
- 네 테이블의 기존 행 수가 모두 0
- 세 Storage 버킷이 존재하고 공개/비공개 설정이 맞음
- 복원 예정 행·사진 수가 manifest와 일치

## 5. Staging 복원 실행과 확인

dry-run 결과를 기록한 뒤 같은 명령 마지막에 `--execute`를 붙입니다.

```bash
APP_ENV=staging \
EXPECTED_STAGING_PROJECT_REF=<staging-project-ref> \
CONFIRM_STAGING_PROJECT_REF=<staging-project-ref> \
node --env-file=.env.staging.local scripts/supabase-restore-staging.mjs \
  /절대/백업/경로 --execute
```

도구는 기존 Staging 데이터를 덮어쓰지 않고 빈 대상에만 `insert`와 `upsert: false` 업로드를 사용합니다. 실행 후에는 모든 테이블을 다시 읽어 JSON 해시를 비교하고 모든 사진을 다시 내려받아 크기와 SHA-256을 확인합니다. `RESTORE_PASS`가 나오지 않으면 Production 배포는 `NO-GO`입니다.

복원 중간에 실패한 Staging은 운영과 무관합니다. 일부 데이터를 임의로 고쳐 재사용하지 말고 원인을 기록한 뒤 새 Staging 프로젝트 또는 명시적으로 초기화한 테스트 환경에서 처음부터 다시 훈련합니다.

## 6. 복구 훈련 완료 기준

- 테이블별 행 수와 JSON fingerprint가 backup manifest와 같음
- 원본·미리보기 객체 수, 바이트 수와 SHA-256이 같음
- DB가 참조하는 사진 누락 0, 고립 사진 0
- 원본 버킷은 공개 URL로 직접 열리지 않음
- 공개 미리보기는 방문자 화면에서 표시됨
- v1.0.x와 v1.1 후보 앱이 같은 Staging 데이터를 읽을 수 있음
- 복구 소요 시간과 작업자를 포함한 테스트 보고서가 남음

## 7. 운영 장애 Runbook

1. 신규 기능 플래그를 끕니다.
2. 데이터 불일치 가능성이 있으면 입력자 쓰기 기능을 일시 중지합니다.
3. 장애 시점의 현재 운영 DB와 Storage를 **추가 백업**합니다.
4. 사고 시각, 영향 책방·월, 마지막 정상 저장 시각을 기록합니다.
5. 앱 문제이면 검증된 이전 Sites 버전 또는 Git tag로 앱만 롤백합니다.
6. DB migration은 되돌리지 않고 신규 필드와 v1.1 입력을 보존합니다.
7. 레코드 수·대표 Submission fingerprint·사진 참조를 읽기 전용으로 확인합니다.
8. DB 자체 손상이 의심될 때만 별도 Staging에 사고 직전 백업을 복원합니다.
9. 복원 결과를 검증한 뒤 필요한 레코드만 운영에 복구하는 별도 계획을 승인받습니다.
10. 운영 정상화 후 원인·복구 시간·재발 방지 조치를 보고서와 GitHub 이슈에 남깁니다.

## 아직 남은 일

- Supabase Staging 프로젝트 생성과 migration 적용
- 1차 운영 백업의 실제 Staging 복원 훈련
- 앱 v1.0.x ↔ v1.1 왕복 호환 테스트
- 독립 장치 또는 암호화 원격 저장소에 두 번째 백업 보관
- 사용 요금제의 자동 백업/PITR 제공 범위 확인과 보존 주기 확정
- 월별 HTML·사진 ZIP 업무 백업 자동화
