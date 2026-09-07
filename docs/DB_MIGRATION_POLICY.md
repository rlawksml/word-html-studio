# DB migration·앱 롤백 호환 정책

이 문서는 앱 v1.1에 문제가 생겨 v1.0.1 코드로 되돌려도 Supabase의 새 데이터가 사라지지 않게 하는 기준입니다. **앱은 롤백할 수 있지만 운영 DB migration은 되돌리지 않습니다.**

## 현재 호환 기준

| 항목 | 값 |
|---|---|
| 롤백 기준 앱 | `1.0.1` |
| 기존 스키마 기준 | `202607240002` |
| 호환성 기반 스키마 | `202609070001` |
| 기간 저장 스키마 | `202609070002` |
| 스키마 식별 | `app_schema_versions`의 `workspace` 행 |
| 기간 일정 저장소 | `news_schedule_ranges` |

`GET /api/version`은 제품 버전, 배포 커밋 환경변수, 실제 DB 스키마 버전과 앱의 예상 버전을 읽기 전용으로 반환합니다. 비밀키, 프로젝트 주소와 작업 암호는 반환하지 않습니다.

## v1.0.1 저장 호환성

월별 소식의 기존 `submissions.news`는 JSONB 배열입니다. 이전 앱은 자신이 아는 필드만 검증하므로 요청값만 저장하면 미래 버전 필드가 사라질 수 있습니다.

v1.0.1 저장 API는 다음 규칙으로 기존 DB와 요청을 합칩니다.

1. 소식 ID가 같은 기존 객체의 알 수 없는 필드를 보존합니다.
2. 제목·상세·사진 설명처럼 v1.0.1이 아는 필드는 새 요청값으로 갱신합니다.
3. 추가 항목·링크·사진도 ID가 같은 객체의 미래 필드를 보존합니다.
4. 사용자가 삭제한 소식·사진은 기존 DB에서 되살리지 않습니다.
5. 요청 배열 순서를 사용해 드래그 정렬 결과를 유지합니다.
6. 클라이언트가 임의로 보낸 미확인 필드는 검증 단계에서 제거하고, 서버가 이미 보관한 DB 값만 호환 병합합니다.

기간 일정은 기존 JSONB에 넣지 않고 별도 `news_schedule_ranges`에 저장합니다. v1.0.1은 이 테이블을 읽거나 갱신하지 않으므로 v1.1에서 만든 기간 데이터가 앱 롤백 중에도 유지됩니다. v1.1은 `save_submission_with_schedule_ranges` RPC로 본문과 기간을 원자적으로 저장하고, 기간 제거는 물리 삭제 대신 `is_active=false`로 남깁니다.

## Expand → Migrate → Contract

### Expand

- 새 nullable 컬럼 또는 새 테이블만 추가합니다.
- 기존 컬럼·테이블·JSON 키의 삭제, 이름 변경, 타입 변경을 금지합니다.
- 새 테이블은 기존 앱이 몰라도 현재 읽기·저장을 방해하지 않아야 합니다.
- 적용한 SQL 파일은 수정하지 않고 더 높은 번호의 새 migration을 추가합니다.

### Migrate

- 새 앱은 호환 기간 동안 기존 데이터와 신규 데이터를 모두 읽습니다.
- 일괄 변환은 여러 번 실행해도 같은 결과가 나와야 합니다.
- 변환 전후 행 수, JSON fingerprint와 사진 참조를 비교합니다.

### Contract

- 최소 두 릴리스의 호환 기간과 별도 승인이 끝나기 전에는 기존 구조를 삭제하지 않습니다.
- 삭제 전 사용량 0, 최신 백업, Staging 복원과 롤백 왕복 테스트가 모두 필요합니다.
- 파괴적 변경은 기능 PR과 분리하고 운영 중 자동 실행하지 않습니다.

## migration 영향표

| migration | 정방향 영향 | 앱 롤백 영향 | DB down migration |
|---|---|---|---|
| `202607210001_initial_workspace.sql` | 책방·소식·레거시 버킷 생성 | 기존 기준 | 금지 |
| `202607220001_secure_media_and_flexible_fields.sql` | 연락처·링크·운영 안내와 보안 버킷 추가 | 선택 필드 기본값으로 호환 | 금지 |
| `202607220002_editing_leases.sql` | 짧은 편집 임대 추가 | 구버전이 무시하며 데이터 유지 | 금지 |
| `202607240001_improvement_requests.sql` | 개선 접수 테이블 추가 | 구버전이 무시 | 금지 |
| `202607240002_improvement_request_types.sql` | 개선 유형 필드·검증 추가 | 기존 개선 목록에 영향 없음 | 금지 |
| `202609070001_rollback_compatibility_foundation.sql` | 스키마 버전·기간 일정 테이블 추가 | v1.0.1이 새 행을 덮어쓰지 않음 | 금지 |
| `202609070002_schedule_range_persistence.sql` | 기간 활성 상태·본문/기간 원자 저장 RPC 추가 | 기존 본문·기간 행 유지 | 금지 |

초기 두 migration의 전체 교체 함수에는 과거 삭제 SQL이 남아 있지만 현재 앱은 호출하지 않습니다. 새 migration에서는 `DROP TABLE`, `DROP COLUMN`, `TRUNCATE`, `DELETE FROM`, 컬럼 이름 변경과 타입 변경을 CI가 거부합니다.

## CI와 migration 불변성

`npm run migration:check`는 다음을 검사합니다.

- 모든 SQL의 SHA-256이 `supabase/migrations/manifest.json`과 일치
- 새 migration에 금지된 파괴적 SQL이 없음
- PR 기준 브랜치에 이미 있던 SQL이 수정·삭제·이름 변경되지 않음
- 새 SQL 파일 추가는 허용하되 manifest에 해시를 함께 기록

manifest는 실수 방지용 장치이며 코드 리뷰를 대신하지 않습니다. 이미 Staging 또는 Production에 적용한 migration은 manifest와 함께 고치는 대신 반드시 새 파일로 보완합니다.

## 안전한 배포와 롤백 순서

1. 현재 DB·Storage를 읽기 전용으로 백업하고 검증합니다.
2. Staging에 additive migration을 먼저 적용합니다.
3. `/api/version`에서 실제 스키마 `202609070001`을 확인합니다.
4. v1.1 전용 JSON·기간 행을 테스트 전용 Submission에 만듭니다.
5. v1.0.1 요청으로 기존 제목·본문을 수정합니다.
6. v1.1 형태로 다시 읽어 미래 JSON과 기간 행이 남았는지 확인합니다.
7. 테스트 전용 행만 정확한 ID로 정리하고 기존 데이터 fingerprint를 재확인합니다.
8. Production은 별도 승인 후 같은 순서로 migration과 앱을 배포합니다.
9. 앱 장애 시 DB를 되돌리지 않고 검증된 v1.0.1 앱만 다시 배포합니다.

왕복 테스트나 백업 검증이 실패하면 v1.1 Production 배포는 `NO-GO`입니다.
