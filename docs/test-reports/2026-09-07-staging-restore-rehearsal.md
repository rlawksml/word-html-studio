# 2026-09-07 Supabase Staging 복원 훈련

## 판정

- TC-DR-001 백업 파일 무결성: `PASS`
- TC-DR-002 Production 복원 차단: `PASS` (자동 테스트)
- TC-DR-003 빈 Staging 실제 복원: `PASS`
- TC-DR-004 부분 복원 안전 재개: `PASS`
- 백업·복원 도구 범위: `GO`
- v1.1 Production 배포: `NO-GO` — Staging 앱 연결과 v1.0.1 호환 검증이 남음

## 검증 대상

- 브랜치: `codex/backup-restore-runbook`
- 복원 대상: 운영과 분리된 Supabase Staging
- 대상 project ref: `kriyjyyudngtibrtkylf`
- 운영 source fingerprint: `7c00407f05b2e7d4`
- Staging target fingerprint: `25cdaef735809b1f`
- 백업 manifest SHA-256: `be1a73bece5f8358401c3b64c2652aeaae40c1487c5c77e3a6348480be46bea5`
- 검증 파일: 107개, 35,025,952 bytes

Secret Key와 사용자 데이터 원문은 이 보고서와 Git에 기록하지 않았다.

## 실행 결과

1. Staging migration 5개를 적용했다.
2. 네 테이블과 세 Storage 버킷이 모두 빈 상태임을 확인했다.
3. 최초 dry-run이 서로 다른 source·target fingerprint, 빈 테이블, 예상 행·사진 수를 확인하고 `DRY_RUN_PASS`를 반환했다.
4. 최초 실행에서 DB 전체와 원본 49개, 미리보기 28개까지 복원된 뒤 미리보기 업로드의 일시적인 Storage 응답 오류로 중단됐다.
5. 중단 직후 읽기 전용 점검에서 알 수 없는 행·객체와 덮어쓰기가 없고 미리보기 21개만 누락된 것을 확인했다.
6. 복원 도구에 `--resume` 모드를 추가했다. 기존 테이블은 전체 JSON 해시, 기존 객체는 크기·SHA-256을 확인하고 예상하지 못한 행·사진이 있으면 중단한다.
7. 첫 재개 실행은 업로드 전에 기존 원본을 읽는 과정에서 `fetch failed | StorageUnknownError`가 3회 이어져 중단됐다. 이 시도에서는 추가 업로드가 없었다.
8. 검증 다운로드를 최대 6회 재시도하도록 보강한 뒤 `RESUME_DRY_RUN_PASS`를 다시 확인했다.
9. `--execute --resume`으로 누락된 미리보기 21개만 추가하고 전체 행과 사진을 다시 내려받아 검증했다.
10. 최종 결과가 `RESTORE_PASS`로 종료됐다.

## 최종 무결성

| 대상 | 백업 | Staging | 결과 |
|---|---:|---:|---|
| bookstores | 8 | 8 | PASS |
| submissions | 12 | 12 | PASS |
| editing_leases | 0 | 0 | PASS |
| improvement_requests | 2 | 2 | PASS |
| 원본 사진 | 49 | 49 | PASS |
| 미리보기 사진 | 49 | 49 | PASS |
| 전체 Storage 객체 | 98 | 98 | PASS |

DB JSON과 Storage 98개 객체의 크기·SHA-256이 manifest와 일치했다.

## 자동 검증

- `node --test tests/backup-safety.test.mjs`: 6/6 PASS
- `npm run lint`: PASS
- `npm test` (production build 포함): 31/31 PASS
- `git diff --check`: PASS

## 데이터 안전 확인

- Production Supabase에는 생성·수정·삭제·복원 요청을 보내지 않았다.
- 복원 명령은 실제·예상·재확인 Staging project ref가 모두 같을 때만 실행됐다.
- 기존 객체는 `upsert: false`로 덮어쓰지 않았다.
- 부분 실패 후 Staging 데이터를 삭제하거나 초기화하지 않았다.
- 재개 과정에서 기존 행·사진의 해시가 다르면 중단하도록 했다.

## 남은 작업

- Staging 앱 연결과 v1.0.1 읽기·저장 왕복 호환 TC는 `2026-09-07-staging-v2-post-deploy.md`에서 PASS
- 암호화된 다른 장치 또는 원격 저장소에 2차 백업
- PR #49는 CI와 코드리뷰 후 `develop`에 병합 완료
