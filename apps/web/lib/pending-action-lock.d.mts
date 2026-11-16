export interface PendingActionLock<Action extends string> {
  begin(action: Action): boolean;
  change(action: Action): void;
  finish(): void;
  readonly current: Action | null;
}

export function createPendingActionLock<Action extends string>(
  onChange: (action: Action | null) => void,
): PendingActionLock<Action>;
