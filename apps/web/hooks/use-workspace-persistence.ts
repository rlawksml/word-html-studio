"use client";

import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { persistBookstore, persistSubmission, WorkspaceConflictError } from "@/lib/workspace-client";
import { rebaseSubmissionSnapshot, restoreSubmissionFromBaseline } from "@/lib/workspace-persistence";
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
  onSubmissionSaved?: (submission: Submission) => void | Promise<void>;
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
  const savedSubmissionsRef = useRef(new Map<number, Submission>());
  const initializedRoleRef = useRef<Role | null>(null);
  const operationRef = useRef<Promise<void>>(Promise.resolve());
  const blockedRecordsRef = useRef(new Set<string>());
  const discardRevisionRef = useRef(0);
  const discardInProgressRef = useRef(false);
  const onSubmissionSavedRef = useRef(onSubmissionSaved);
  useEffect(() => {
    bookstoresRef.current = bookstores;
    submissionsRef.current = submissions;
    onSubmissionSavedRef.current = onSubmissionSaved;
  }, [bookstores, onSubmissionSaved, submissions]);

  const seedBaseline = useCallback((workspace: Workspace) => {
    bookstoreBaselineRef.current = new Map(workspace.bookstores.map((item) => [item.id, fingerprint(item)]));
    submissionBaselineRef.current = new Map(workspace.submissions.map((item) => [item.id, fingerprint(item)]));
    savedSubmissionsRef.current = new Map(workspace.submissions.map((item) => [item.id, item]));
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
    savedSubmissionsRef.current.set(saved.id, saved);
    blockedRecordsRef.current.delete(`submission:${saved.id}`);
    const next = submissionsRef.current.map((current) => {
      if (current.id !== saved.id) return current;
      const local = localTransform ? localTransform(current) : current;
      return { ...local, updatedAt: saved.updatedAt, publishedAt: saved.publishedAt, publishedUrl: saved.publishedUrl };
    });
    submissionsRef.current = next;
    setSubmissions(next);
    const adopted = next.find((submission) => submission.id === saved.id) || saved;
    await onSubmissionSavedRef.current?.(adopted);
  }, [setSubmissions]);

  const saveDirtyRecords = useCallback(async (manual: boolean) => {
    if (!enabled || discardInProgressRef.current || (role !== "input" && role !== "html")) return;
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

  // 화면을 떠나는 순간에는 effect/ref 갱신 타이밍에 기대지 않고 화면이 넘긴 정확한 스냅샷을 저장합니다.
  const saveSubmissionSnapshot = useCallback((snapshot: Submission) => serialize(async () => {
    const recordKey = `submission:${snapshot.id}`;
    if (blockedRecordsRef.current.has(recordKey)) throw new WorkspaceConflictError("다른 작업자의 변경을 먼저 확인해 주세요.");
    setSaveState("마지막 입력 내용을 저장 중...");
    try {
      // 앞서 큐에 있던 자동 저장이 방금 끝났다면 그 응답의 최신 버전만 이어받고 화면 내용은 그대로 보냅니다.
      const current = submissionsRef.current.find((submission) => submission.id === snapshot.id);
      const versionedSnapshot = rebaseSubmissionSnapshot(snapshot, current);
      const saved = await persistSubmission(versionedSnapshot);
      await adoptSubmission(saved, () => versionedSnapshot);
      setStorageError("");
      setSaveState(`임시 저장됨 · ${savedClock()}`);
      return saved;
    } catch (error) {
      throw recordFailure(error, recordKey);
    }
  }), [adoptSubmission, recordFailure, serialize, setSaveState, setStorageError]);

  const discardSubmissionChanges = useCallback((submissionId: number) => {
    // 예약된 자동 저장은 revision으로 무효화하고, 이미 실행 중인 요청은 끝난 뒤 그 서버 결과를 기준으로 되돌립니다.
    discardRevisionRef.current += 1;
    discardInProgressRef.current = true;
    return serialize(async () => {
      try {
        const baseline = savedSubmissionsRef.current.get(submissionId);
        const next = restoreSubmissionFromBaseline(submissionsRef.current, submissionId, baseline);
        submissionsRef.current = next;
        setSubmissions(next);
        blockedRecordsRef.current.delete(`submission:${submissionId}`);
        if (!baseline) {
          submissionBaselineRef.current.delete(submissionId);
          savedSubmissionsRef.current.delete(submissionId);
        }
        setStorageError("");
        setSaveState("저장하지 않은 변경을 버렸습니다");
        return baseline ?? null;
      } finally {
        discardInProgressRef.current = false;
      }
    });
  }, [serialize, setSaveState, setStorageError, setSubmissions]);

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
    const scheduledRevision = discardRevisionRef.current;
    const timer = window.setTimeout(() => {
      if (scheduledRevision !== discardRevisionRef.current || discardInProgressRef.current) return;
      void saveNow(false).catch(() => undefined);
    }, 1_200);
    return () => window.clearTimeout(timer);
  }, [bookstores, enabled, role, saveNow, seedBaseline, submissions]);

  return {
    replaceWorkspace,
    saveNow,
    saveBookstoreChange,
    saveSubmissionChange,
    saveSubmissionSnapshot,
    discardSubmissionChanges,
  };
}
