import {
  createContext,
  use,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';

/**
 * The last breadcrumb of a detail screen — a record's human-readable reference, such as a contract
 * number. The shell draws the trail; only the page knows the record, so it hands the label up here.
 * The tail is cleared when the page unmounts, so it never outlives the record it names.
 */
const TailContext = createContext<{
  tail: string | undefined;
  setTail: Dispatch<SetStateAction<string | undefined>>;
} | null>(null);

export function BreadcrumbProvider({ children }: { children: ReactNode }) {
  const [tail, setTail] = useState<string | undefined>();
  const value = useMemo(() => ({ tail, setTail }), [tail]);
  return <TailContext value={value}>{children}</TailContext>;
}

export function useBreadcrumbTailValue(): string | undefined {
  return use(TailContext)?.tail;
}

export function useBreadcrumbTail(label: string | undefined): void {
  const setTail = use(TailContext)?.setTail;
  useEffect(() => {
    if (!setTail) return undefined;
    setTail(label);
    return () => setTail(undefined);
  }, [label, setTail]);
}
