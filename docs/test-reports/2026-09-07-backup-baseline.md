# 2026-09-07 v1.1 이전 백업 기준선

## 판정

- 로컬 읽기 전용 백업: `PASS`
- 압축 파일 gzip 무결성: `PASS`
- 임시 디렉터리 압축 해제 후 전체 파일 재검증: `PASS`
- 별도 Supabase Staging 실제 복원: `PENDING`
- Production 변경: 없음

Staging 복원이 끝나기 전까지 #47은 완료가 아니며 Production v1.1 배포 판정은 `NO-GO`입니다.

## 코드 복귀 지점

| 구분 | 값 |
|---|---|
| 현재 운영 배포 기준 tag | `v1.0.0` |
| 운영 배포 기준 commit | `28efad2e9331b5e2951bf1d9b00cb553530130f7` |
| v1.1 시작 전 tag | `pre-v1.1-20260907` |
| v1.1 시작 전 commit | `3affe71109f5c51a497c92c6bd7bdba8b679c6c5` |

## 백업 검증 결과

| 대상 | 개수 |
|---|---:|
| `bookstores` | 8행 |
| `submissions` | 12행 |
| `editing_leases` | 0행 |
| `improvement_requests` | 2행 |
| 소식 | 46개 |
| DB 사진 참조 | 49개 |
| 비공개 원본 사진 | 49개 |
| 공개 미리보기 | 49개 |
| 검증 파일 | 102개 |
| 검증 바이트 | 35,014,696 bytes |

- 누락 원본: 0
- 누락 미리보기: 0
- 고립 원본: 0
- 고립 미리보기: 0
- backup manifest SHA-256: `be1a73bece5f8358401c3b64c2652aeaae40c1487c5c77e3a6348480be46bea5`
- 압축 파일 SHA-256: `f802abf745fc6e05e202a08ba83cd377e993ad3750348b3b49d052c5bda5b068`

백업 데이터·사진·비밀값은 GitHub에 올리지 않았습니다. 이 보고서에는 공개 가능한 집계와 검증값만 기록합니다.

## 주의 사항

- 현재 백업은 운영 서비스와 다른 폴더지만 같은 물리 장치에 있습니다.
- 앱 tag는 즉시 되돌릴 코드 지점이며, DB 손상 복구를 대신하지 않습니다.
- 실제 복구 가능성은 별도 Supabase Staging에서 복원해야 확정됩니다.
- Production에서는 GET/SELECT/Storage download만 수행했고 행·사진을 생성·수정·삭제하지 않았습니다.
