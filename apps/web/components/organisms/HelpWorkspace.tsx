import { UtilityPageHeader } from "@/components/molecules/UtilityPageHeader";
import Link from "next/link";

const guidePdf = "/guides/bookstore-news-input-guide.pdf";

export function HelpWorkspace() {
  return <main className="utility-shell">
    <UtilityPageHeader current="help" />
    <section className="utility-hero help-hero">
      <span>USER GUIDE</span>
      <h1>Word를 작성하듯, 책방 소식을 한 곳씩 입력하세요.</h1>
      <p>HTML이나 CSS를 몰라도 괜찮습니다. 발행 월과 책방을 고르고 제목과 상세 내용부터 작성하면 됩니다.</p>
      <div className="help-hero-actions">
        <a className="primary-button" href={guidePdf} target="_blank" rel="noreferrer">PDF 가이드 열기</a>
        <a className="secondary-button" href={guidePdf} download>PDF 다운로드</a>
      </div>
    </section>

    <section className="help-content">
      <nav className="help-toc" aria-label="가이드 목차">
        <strong>빠른 목차</strong>
        <a href="#start">1. 소식 입력 시작</a>
        <a href="#bookstore">2. 발행 월과 책방</a>
        <a href="#news">3. 소식 작성</a>
        <a href="#photos">4. 사진 첨부</a>
        <a href="#save">5. 저장과 마무리</a>
        <a href="#faq">6. 자주 묻는 질문</a>
      </nav>

      <div className="help-guide">
        <section id="start">
          <span>STEP 01</span><h2>소식 입력 화면에 접속합니다.</h2>
          <ol><li>메인 화면 오른쪽 위의 <strong>소식 입력</strong>을 누릅니다.</li><li>운영 담당자에게 전달받은 작업 암호를 입력합니다.</li><li>책방 소식 입력 목록이 보이면 준비가 끝났습니다.</li></ol>
          <p className="help-note">작업 암호는 가이드나 공개 화면에 표시되지 않습니다. 한글·영문 자판 상태와 관계없이 입력할 수 있습니다.</p>
        </section>

        <section id="bookstore">
          <span>STEP 02</span><h2>발행 월과 작성할 책방을 선택합니다.</h2>
          <ol><li><strong>이전 달·다음 달</strong> 버튼으로 실제 발행할 월을 맞춥니다.</li><li>목록에서 한 책방을 선택해 한 곳씩 작성합니다.</li><li>처음 참여하는 책방이라면 <strong>책방 관리</strong>에서 이름과 지역을 먼저 등록합니다.</li></ol>
          <p className="help-note">다른 사용자가 같은 책방을 편집 중이면 해당 책방에는 들어갈 수 없습니다. 정상 종료 시 바로 풀리고, 비정상 종료 시 약 3분 뒤 자동으로 풀립니다.</p>
        </section>

        <section id="news">
          <span>STEP 03</span><h2>소식 제목과 상세 내용을 먼저 작성합니다.</h2>
          <div className="help-field-table">
            <div><strong>필수</strong><p>소식 제목, 상세 내용</p></div>
            <div><strong>선택</strong><p>여러 날짜, 일정 안내, 정기 표시, 신청 마감일, 장소, 참가비, 신청 방법, 추가 항목과 링크</p></div>
          </div>
          <ul><li>행사가 여러 날이면 날짜를 여러 개 추가할 수 있습니다.</li><li>날짜로 표현하기 어려운 일정은 <strong>일정 안내</strong>에 문장으로 적습니다.</li><li>소식이 여러 개라면 <strong>소식 추가</strong>를 누르고 드래그하거나 화살표로 순서를 바꿉니다.</li><li>작성 중에도 <strong>작성 내용 미리보기</strong>로 실제 HTML 모양을 확인할 수 있습니다.</li></ul>
        </section>

        <section id="photos">
          <span>STEP 04</span><h2>사진은 버튼으로 고르거나 끌어다 놓습니다.</h2>
          <ul><li>JPG, PNG, WEBP, GIF, HEIC 사진을 여러 장 첨부할 수 있습니다.</li><li>사진 한 장은 20MB 이하를 권장합니다.</li><li>사진 아래 설명은 선택 항목이며, 화살표 또는 드래그로 표시 순서를 바꿀 수 있습니다.</li><li>방문자에게는 빠른 미리보기가, HTML 작업자에게는 원본 다운로드가 제공됩니다.</li></ul>
        </section>

        <section id="save">
          <span>STEP 05</span><h2>자동 저장을 확인하고 책방별로 입력을 마무리합니다.</h2>
          <ol><li>입력 내용은 잠시 후 자동 저장됩니다. 중요한 시점에는 <strong>임시 저장</strong>을 눌러도 됩니다.</li><li>반복되는 내용은 <strong>지난달 불러오기</strong>로 가져온 뒤 날짜와 신청 정보를 다시 확인합니다.</li><li>필수 항목을 모두 작성한 뒤 <strong>입력 마무리</strong>를 누릅니다.</li><li>모든 책방이 끝나면 목록의 <strong>완료 내용 공유하기</strong>로 메신저 안내 문구를 복사합니다.</li></ol>
          <p className="help-note">입력 마무리 후 내용을 다시 수정하면 상태는 자동으로 작성 중으로 돌아갑니다.</p>
        </section>

        <section id="faq">
          <span>FAQ</span><h2>자주 묻는 질문</h2>
          <details><summary>사진 업로드가 끝나지 않아요.</summary><p>한 장이 20MB를 넘지 않는지 확인하고, 업로드가 끝난 뒤 다음 사진을 추가해 주세요. 계속 실패하면 새로고침 후 다시 시도합니다.</p></details>
          <details><summary>필수로 입력해야 하는 내용은 무엇인가요?</summary><p>각 소식의 제목과 상세 내용 두 가지입니다. 날짜·장소·신청 정보·사진은 필요한 경우에만 입력합니다.</p></details>
          <details><summary>페이지를 나가도 작성 내용이 남나요?</summary><p>자동 저장되며, 작성 중에 메인 화면이나 뒤로가기를 누르면 임시 저장 후 나갈 수 있도록 안내합니다.</p></details>
          <details><summary>사용 중 불편한 점이 생기면 어디에 남기나요?</summary><p>헤더의 <Link href="/improvements">개선사항</Link>에서 제목과 내용을 접수하고 진행 상태를 확인할 수 있습니다.</p></details>
        </section>
      </div>
    </section>
  </main>;
}
