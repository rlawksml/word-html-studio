"use client";

import { useState, type Dispatch, type SetStateAction } from "react";
import { blankBookstore, makeLink, makeValue } from "@/lib/workspace-formatters";
import type { Bookstore } from "@/lib/workspace-types";

type BookstoreManagementProps = {
  bookstores: Bookstore[];
  setBookstores: Dispatch<SetStateAction<Bookstore[]>>;
  onBack: () => void;
  notify: (message: string) => void;
};

export function BookstoreManagement({ bookstores, setBookstores, onBack, notify }: BookstoreManagementProps) {
  const [form, setForm] = useState<Bookstore>(blankBookstore());
  const [editingId, setEditingId] = useState<number | null>(null);
  const edit = (bookstore?: Bookstore) => { setForm(bookstore ? { ...bookstore } : blankBookstore()); setEditingId(bookstore?.id ?? null); };
  const save = () => {
    if (!form.name.trim() || !form.region.trim()) { notify("책방 이름과 지역을 입력해 주세요."); return; }
    setBookstores((current) => editingId === null ? [...current, form] : current.map((item) => item.id === editingId ? form : item));
    edit();
    notify(editingId === null ? "새 책방을 저장했습니다." : "책방 정보를 수정했습니다.");
  };
  const field = (key: Exclude<keyof Bookstore, "id" | "contacts" | "links">, value: string) => setForm((current) => ({ ...current, [key]: value }));
  return <div className="bookstore-management">
    <div className="workspace-heading"><div><button className="back-button" onClick={onBack}>← 뒤로가기</button><h1>책방 관리</h1><p>한 번 저장한 기본정보는 매월 소식 작성에 다시 사용됩니다.</p></div><button className="primary-button" onClick={() => edit()}>＋ 새 책방</button></div>
    <div className="management-grid">
      <div className="management-list">{bookstores.map((bookstore) => <button className={editingId === bookstore.id ? "active" : ""} key={bookstore.id} onClick={() => edit(bookstore)}><strong>{bookstore.name}</strong><span>{bookstore.region}</span><small>{bookstore.address || "주소 미등록"}</small></button>)}</div>
      <div className="management-form"><h2>{editingId === null ? "새 책방 등록" : "책방 정보 수정"}</h2>
        <div className="form-grid">
          <label><span>책방 이름 *</span><input value={form.name} onChange={(event) => field("name", event.target.value)} /></label>
          <label><span>지역 *</span><input value={form.region} onChange={(event) => field("region", event.target.value)} placeholder="예: 울산 남구" /></label>
          <label className="wide"><span>주소</span><input value={form.address} onChange={(event) => field("address", event.target.value)} /></label>
          <label className="wide"><span>책방 소개</span><textarea rows={3} value={form.introduction} onChange={(event) => field("introduction", event.target.value)} /></label>
          <label><span>영업시간</span><input value={form.hours} onChange={(event) => field("hours", event.target.value)} /></label>
          <label><span>대표 연락처</span><input value={form.phone} onChange={(event) => field("phone", event.target.value)} /></label>
          <label><span>대표 SNS</span><input value={form.sns} onChange={(event) => field("sns", event.target.value)} placeholder="https://instagram.com/..." /></label>
          <label><span>홈페이지</span><input value={form.website} onChange={(event) => field("website", event.target.value)} placeholder="https://..." /></label>
        </div>
        <div className="repeatable-section"><div><strong>추가 연락처</strong><small>책방지기 연락처처럼 대표 연락처와 구분할 정보가 있을 때 사용합니다.</small></div>{(form.contacts || []).map((contact) => <div className="repeatable-row" key={contact.id}><input value={contact.label} onChange={(event) => setForm((current) => ({ ...current, contacts: current.contacts.map((item) => item.id === contact.id ? { ...item, label: event.target.value } : item) }))} placeholder="연락처 이름" /><input value={contact.value} onChange={(event) => setForm((current) => ({ ...current, contacts: current.contacts.map((item) => item.id === contact.id ? { ...item, value: event.target.value } : item) }))} placeholder="전화번호 또는 안내" /><button onClick={() => setForm((current) => ({ ...current, contacts: current.contacts.filter((item) => item.id !== contact.id) }))}>삭제</button></div>)}<button className="text-add-button" onClick={() => setForm((current) => ({ ...current, contacts: [...(current.contacts || []), makeValue()] }))}>＋ 연락처 추가</button></div>
        <div className="repeatable-section"><div><strong>추가 링크</strong><small>블로그, 두 번째 SNS 등 여러 주소를 등록할 수 있습니다.</small></div>{(form.links || []).map((link) => <div className="repeatable-row" key={link.id}><input value={link.label} onChange={(event) => setForm((current) => ({ ...current, links: current.links.map((item) => item.id === link.id ? { ...item, label: event.target.value } : item) }))} placeholder="링크 이름" /><input value={link.url} onChange={(event) => setForm((current) => ({ ...current, links: current.links.map((item) => item.id === link.id ? { ...item, url: event.target.value } : item) }))} placeholder="https://..." /><button onClick={() => setForm((current) => ({ ...current, links: current.links.filter((item) => item.id !== link.id) }))}>삭제</button></div>)}<button className="text-add-button" onClick={() => setForm((current) => ({ ...current, links: [...(current.links || []), makeLink()] }))}>＋ 링크 추가</button></div>
        <div className="form-actions"><button className="secondary-button" onClick={() => edit()}>취소</button><button className="primary-button" onClick={save}>저장</button></div>
      </div>
    </div>
  </div>;
}
