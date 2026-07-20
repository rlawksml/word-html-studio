# 책방소식 웹 프로토타입

Next.js 16과 TypeScript로 만든 역할별 인터랙티브 프로토타입입니다.

## 실행

Node.js 22.13 이상이 필요합니다.

```bash
npm install
npm run dev
```

로컬 주소는 `http://localhost:3000`입니다.

## 프로토타입 접근

- 방문자: 별도 코드 없음
- 정보 입력자: `지관서가`
- HTML 편집자: `지관서가2`

작업자 접근 상태는 해당 탭의 세션 동안만 유지됩니다.

## 검증

```bash
npm run lint
npm test
npm run build
```

## 제한

현재 입력 자료와 이미지는 브라우저 `localStorage`에만 저장됩니다. 역할 간 실제 공유, 운영 인증, 원본/미리보기 이미지 저장은 D1·R2를 연결하는 다음 마일스톤에서 구현합니다.
