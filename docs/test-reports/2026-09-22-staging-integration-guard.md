# Staging 전용 통합 테스트 실행 보호

## 원인과 수정

기존 통합 테스트는 RUN 스위치로 활성화되며 직접 Supabase admin client를 3곳에서 생성했다. 앱 런타임의 production/unset 호환 정책에 기대면 잘못된 환경에서 테스트 쓰기가 시작될 가능성이 있어, 테스트 모듈 진입 시 고정 Staging allowlist를 확인하도록 추가했다. 실제 사고가 발생했다는 증거는 없으며 예방 수정이다.

독립 사전 안전 리뷰 승인 후 APP_ENV·정확한 URL·expected ref·운영 denylist를 검사한다. URL credentials/port/path/query/fragment/공백을 거부하고 실제 값은 오류에 출력하지 않는다. 운영 런타임 코드는 바꾸지 않았다.

## 검증

- 환경 검사 단위 3/3 PASS. 그중 새 검사에는 정상 2개와 잘못된 설정 15개 조합을 포함한다.
- typecheck·lint·build 및 전체 회귀 82/82 PASS. 기존 큰 chunk·Vite native config·route 분류 경고는 유지된다.
- `npm run test:integration`: 실행 스위치 미설정, 실제 테스트 3개 SKIPPED. DB/Storage 호출 없음.
- 실제 Staging 쓰기 검증은 이번 범위에서 미실행. 배포 도구 #77과 별개로 테스트 실행 안전성을 보완한 변경이다.
- 기존 데이터·환경변수·배포·마이그레이션·merge 변경 없음.
