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
 * 최신 입력을 덮지 않게 하고, 실제 updatedAt 충돌이 난 레코드만 사용자 확인 전까지 멈춥니다.
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
  const blockedRecordsRef = useRef(new Set<string>());
  const onSubmissionSavedRef = useRef(onSubmissionSaved);
  useEffect(() => {
    bookstoresRef.current = bookstores;
    submissionsRef.current = submissions;
    onSubmissionSavedRef.current = onSubmissionSaved;
  }, [bookstores, onSubmissionSaved, submissions]);

  const seedBaseline = useCallback((workspace: Workspace) => {
    bookstoreBaselineRef.current = new Map(workspace.bookstores.map((item) => [item.id, fingerprint(item)]));
    submissionBaselineRef.current = new Map(workspace.submissions.map((item) => [item.id, fingerprint(item)]));
    blockedRecordsRef.current.clear();
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

  const recordFailure = useCallback((error: unknown, recordKey: string) => {
    const conflict = error instanceof WorkspaceConflictError;
    if (conflict) blockedRecordsRef.current.add(recordKey);
    const message = error instanceof Error ? error.message : "공용 저장소에 저장하지 못했습니다.";
    setStorageError(message);
    setSaveState(conflict ? "저장 충돌 · 최신 내용 확인 필요" : "자동 저장 실패");
    return error instanceof Error ? error : new Error(message);
  }, [setSaveState, setStorageError]);

  const adoptBookstore = useCallback((saved: Bookstore) => {
    bookstoreBaselineRef.current.set(saved.id, fingerprint(saved));
    blockedRecordsRef.current.delete(`bookstore:${saved.id}`);
    const exists = bookstoresRef.current.some((current) => current.id === saved.id);
    const next = exists
      ? bookstoresRef.current.map((current) => current.id === saved.id ? saved : current)
      : [...bookstoresRef.current, saved];
    bookstoresRef.current = next;
    setBookstores(next);
  }, [setBookstores]);

  const adoptSubmission = useCallback(async (saved: Submission, localTransform?: (submission: Submission) => Submission) => {
    submissionBaselineRef.current.set(saved.id, fingerprint(saved));
    blockedRecordsRef.current.delete(`submission:${saved.id}`);
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
    if (!enabled || (role !== "input" && role !== "html")) return;
    const changedBookstores = role === "input"
      ? bookstoresRef.current.filter((item) => (
          !blockedRecordsRef.current.has(`bookstore:${item.id}`)
          && bookstoreBaselineRef.current.get(item.id) !== fingerprint(item)
        ))
      : [];
    const changedSubmissions = submissionsRef.current.filter((item) => (
      !blockedRecordsRef.current.has(`submission:${item.id}`)
      && submissionBaselineRef.current.get(item.id) !== fingerprint(item)
    ));
    if (!changedBookstores.length && !changedSubmissions.length) {
      const hasBlockedChanges = bookstoresRef.current.some((item) => (
        blockedRecordsRef.current.has(`bookstore:${item.id}`)
        && bookstoreBaselineRef.current.get(item.id) !== fingerprint(item)
      )) || submissionsRef.current.some((item) => (
        blockedRecordsRef.current.has(`submission:${item.id}`)
        && submissionBaselineRef.current.get(item.id) !== fingerprint(item)
      ));
      if (manual && hasBlockedChanges) throw new WorkspaceConflictError("저장 충돌이 난 내용은 최신 내용을 불러온 뒤 다시 수정해 주세요.");
      if (manual) setSaveState(`임시 저장됨 · ${savedClock()}`);
      return;
    }
    setSaveState("공용 저장소에 저장 중...");
    let firstError: Error | null = null;
    for (const bookstore of changedBookstores) {
      try {
        adoptBookstore(await persistBookstore(bookstore));
      } catch (error) {
        firstError ||= recordFailure(error, `bookstore:${bookstore.id}`);
      }
    }
    for (const submission of changedSubmissions) {
      try {
        await adoptSubmission(await persistSubmission(submission));
      } catch (error) {
        firstError ||= recordFailure(error, `submission:${submission.id}`);
      }
    }
    if (firstError) throw firstError;
    setStorageError("");
    setSaveState(`${manual ? "임시 저장됨" : "자동 저장됨"} · ${savedClock()}`);
  }, [adoptBookstore, adoptSubmission, enabled, recordFailure, role, setSaveState, setStorageError]);

  const saveNow = useCallback((manual = true) => serialize(() => saveDirtyRecords(manual)), [saveDirtyRecords, serialize]);

  const saveBookstoreChange = useCallback((bookstore: Bookstore) => serialize(async () => {
    const recordKey = `bookstore:${bookstore.id}`;
    setSaveState("책방 정보를 저장 중...");
    try {
      const saved = await persistBookstore(bookstore);
      adoptBookstore(saved);
      setStorageError("");
      setSaveState(`책방 정보 저장됨 · ${savedClock()}`);
      return saved;
    } catch (error) {
      throw recordFailure(error, recordKey);
    }
  }), [adoptBookstore, recordFailure, serialize, setSaveState, setStorageError]);

  const saveSubmissionChange = useCallback((submissionId: number, transform: (submission: Submission) => Submission) => serialize(async () => {
    const recordKey = `submission:${submissionId}`;
    if (blockedRecordsRef.current.has(recordKey)) throw new WorkspaceConflictError("다른 작업자의 변경을 먼저 확인해 주세요.");
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
      throw recordFailure(error, recordKey);
    }
  }), [adoptSubmission, recordFailure, serialize, setSaveState, setStorageError]);

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
    const timer = window.setTimeout(() => { void saveNow(false).catch(() => undefined); }, 1_200);
    return () => window.clearTimeout(timer);
  }, [bookstores, enabled, role, saveNow, seedBaseline, submissions]);

  return { replaceWorkspace, saveNow, saveBookstoreChange, saveSubmissionChange };
}
