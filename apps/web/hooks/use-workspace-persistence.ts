"use client";

import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { persistBookstore, persistSubmission, WorkspaceConflictError } from "@/lib/workspace-client";
import type { Role } from "@/lib/workspace-formatters";
import type { Bookstore, Submission, Workspace } from "@/lib/workspace-types";

type PersistenceOptions = {
  enabled: boolean;
  role: Role;
  bookstores: Bookstore[];
  submissions: Submission[];
  setBookstores: Dispatch<SetStateAction<Bookstore[]>>;
  setSubmissions: Dispatch<SetStateAction<Submission[]>>;
  setSaveState: Dispatch<SetStateAction<string>>;
  setStorageError: Dispatch<SetStateAction<string>>;
  onSubmissionSaved?: (submissionId: number) => void | Promise<void>;
};

const fingerprint = (value: Bookstore | Submission) => JSON.stringify(value);
const savedClock = () => new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit" }).format(new Date());

/**
 * 레코드별 변경 감지와 저장 순서를 담당합니다. 네트워크 요청을 직렬화해 늦게 끝난 이전 요청이
 * 최신 입력을 덮지 않게 하고, 서버의 updatedAt 충돌은 사용자 확인 전까지 자동 재시도하지 않습니다.
 */
export function useWorkspacePersistence(options: PersistenceOptions) {
  const {
    enabled, role, bookstores, submissions, setBookstores, setSubmissions,
    setSaveState, setStorageError, onSubmissionSaved,
  } = options;
  const bookstoresRef = useRef(bookstores);
  const submissionsRef = useRef(submissions);
  const bookstoreBaselineRef = useRef(new Map<number, string>());
  const submissionBaselineRef = useRef(new Map<number, string>());
  const initializedRoleRef = useRef<Role | null>(null);
  const operationRef = useRef<Promise<void>>(Promise.resolve());
  const conflictRef = useRef(false);
  const onSubmissionSavedRef = useRef(onSubmissionSaved);
  useEffect(() => {
    bookstoresRef.current = bookstores;
    submissionsRef.current = submissions;
    onSubmissionSavedRef.current = onSubmissionSaved;
  }, [bookstores, onSubmissionSaved, submissions]);

  const seedBaseline = useCallback((workspace: Workspace) => {
    bookstoreBaselineRef.current = new Map(workspace.bookstores.map((item) => [item.id, fingerprint(item)]));
    submissionBaselineRef.current = new Map(workspace.submissions.map((item) => [item.id, fingerprint(item)]));
    conflictRef.current = false;
  }, []);

  const replaceWorkspace = useCallback((workspace: Workspace) => {
    bookstoresRef.current = workspace.bookstores;
    submissionsRef.current = workspace.submissions;
    seedBaseline(workspace);
    setBookstores(workspace.bookstores);
    setSubmissions(workspace.submissions);
    setStorageError("");
    setSaveState("모든 내용이 저장되었습니다");
  }, [seedBaseline, setBookstores, setSaveState, setStorageError, setSubmissions]);

  const serialize = useCallback(<T,>(operation: () => Promise<T>) => {
    const next = operationRef.current.catch(() => undefined).then(operation);
    operationRef.current = next.then(() => undefined, () => undefined);
    return next;
  }, []);

  const handleFailure = useCallback((error: unknown) => {
    const conflict = error instanceof WorkspaceConflictError;
    if (conflict) conflictRef.current = true;
    const message = error instanceof Error ? error.message : "공용 저장소에 저장하지 못했습니다.";
    setStorageError(message);
    setSaveState(conflict ? "저장 충돌 · 최신 내용 확인 필요" : "자동 저장 실패");
    throw error;
  }, [setSaveState, setStorageError]);

  const adoptBookstore = useCallback((saved: Bookstore) => {
    bookstoreBaselineRef.current.set(saved.id, fingerprint(saved));
    const next = bookstoresRef.current.map((current) => current.id === saved.id ? { ...current, updatedAt: saved.updatedAt, sortOrder: saved.sortOrder } : current);
    bookstoresRef.current = next;
    setBookstores(next);
  }, [setBookstores]);

  const adoptSubmission = useCallback(async (saved: Submission, localTransform?: (submission: Submission) => Submission) => {
    submissionBaselineRef.current.set(saved.id, fingerprint(saved));
    const next = submissionsRef.current.map((current) => {
      if (current.id !== saved.id) return current;
      const local = localTransform ? localTransform(current) : current;
      return { ...local, updatedAt: saved.updatedAt, publishedAt: saved.publishedAt, publishedUrl: saved.publishedUrl };
    });
    submissionsRef.current = next;
    setSubmissions(next);
    await onSubmissionSavedRef.current?.(saved.id);
  }, [setSubmissions]);

  const saveDirtyRecords = useCallback(async (manual: boolean) => {
    if (!enabled || (role !== "input" && role !== "html") || conflictRef.current) return;
    const changedBookstores = role === "input"
      ? bookstoresRef.current.filter((item) => bookstoreBaselineRef.current.get(item.id) !== fingerprint(item))
      : [];
    const changedSubmissions = submissionsRef.current.filter((item) => submissionBaselineRef.current.get(item.id) !== fingerprint(item));
    if (!changedBookstores.length && !changedSubmissions.length) {
      if (manual) setSaveState(`임시 저장됨 · ${savedClock()}`);
      return;
    }
    setSaveState("공용 저장소에 저장 중...");
    try {
      for (const bookstore of changedBookstores) adoptBookstore(await persistBookstore(bookstore));
      for (const submission of changedSubmissions) await adoptSubmission(await persistSubmission(submission));
      setStorageError("");
      setSaveState(`${manual ? "임시 저장됨" : "자동 저장됨"} · ${savedClock()}`);
    } catch (error) {
      handleFailure(error);
    }
  }, [adoptBookstore, adoptSubmission, enabled, handleFailure, role, setSaveState, setStorageError]);

  const saveNow = useCallback((manual = true) => serialize(() => saveDirtyRecords(manual)), [saveDirtyRecords, serialize]);

  const saveSubmissionChange = useCallback((submissionId: number, transform: (submission: Submission) => Submission) => serialize(async () => {
    if (conflictRef.current) throw new WorkspaceConflictError("다른 작업자의 변경을 먼저 확인해 주세요.");
    const current = submissionsRef.current.find((item) => item.id === submissionId);
    if (!current) throw new Error("사진을 연결할 소식을 찾지 못했습니다.");
    setSaveState("사진 정보 저장 중...");
    try {
      const saved = await persistSubmission(transform(current));
      await adoptSubmission(saved, transform);
      setStorageError("");
      setSaveState(`자동 저장됨 · ${savedClock()}`);
      return saved;
    } catch (error) {
      return handleFailure(error);
    }
  }), [adoptSubmission, handleFailure, serialize, setSaveState, setStorageError]);

  useEffect(() => {
    if (!enabled || (role !== "input" && role !== "html")) {
      initializedRoleRef.current = null;
      return;
    }
    if (initializedRoleRef.current !== role) {
      initializedRoleRef.current = role;
      seedBaseline({ bookstores, submissions });
      return;
    }
    if (conflictRef.current) return;
    const timer = window.setTimeout(() => { void saveNow(false).catch(() => undefined); }, 1_200);
    return () => window.clearTimeout(timer);
  }, [bookstores, enabled, role, saveNow, seedBaseline, submissions]);

  return { replaceWorkspace, saveNow, saveSubmissionChange };
}
