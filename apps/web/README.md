# 책방소식 웹 앱

Next.js 16, TypeScript, Supabase Database·Storage로 만든 동네책방 소식 입력·발행 웹 앱입니다.

## 실행

Node.js 22.13 이상과 `apps/web/.env.local`의 Supabase 서버 환경변수가 필요합니다.

```bash
npm install
npm run dev
```

로컬 주소는 `http://localhost:3000`입니다. 작업 암호와 Supabase Secret Key는 클라이언트 번들에 포함하지 않습니다. 자세한 초기 설정은 `docs/SUPABASE_SETUP.md`를 확인하세요.

## 검증

```bash
npm run lint
npm test
npm run build
```

## 저장 구조

- Supabase Database: 책방 기본정보, 월별 운영 안내, 소식과 상태
- Private Storage: HTML 편집자용 원본 사진
- Public Storage: 방문자용 축소 미리보기
- 작업 세션: HttpOnly 서명 쿠키 + 탭 단위 임의 세션 ID
