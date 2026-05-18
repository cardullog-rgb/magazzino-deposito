import { useEffect, useRef, useState } from "react";
import { Check, X } from "lucide-react";

type Option = { value: string | number; label: string };

interface Props {
  value: string | number;
  onSave: (v: string | number) => Promise<unknown> | void;
  type?: "text" | "number";
  options?: Option[];                 // se passato, diventa select
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  suffix?: string;                    // es. "pz", "kg" mostrato a destra
  disabled?: boolean;
  testId?: string;
  align?: "left" | "right" | "center";
}

export function InlineEdit({
  value, onSave, type = "text", options, placeholder, className,
  inputClassName, suffix, disabled, testId, align = "left",
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(String(value ?? ""));
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement | HTMLSelectElement | null>(null);

  useEffect(() => {
    if (!editing) setDraft(String(value ?? ""));
  }, [value, editing]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      if (inputRef.current instanceof HTMLInputElement) inputRef.current.select();
    }
  }, [editing]);

  async function commit() {
    if (saving) return;
    let next: string | number = draft;
    if (type === "number") {
      const n = parseFloat(draft);
      if (Number.isNaN(n)) return cancel();
      next = n;
    }
    if (next === value) { setEditing(false); return; }
    setSaving(true);
    try {
      await onSave(next);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }
  function cancel() {
    setDraft(String(value ?? ""));
    setEditing(false);
  }

  if (disabled) {
    return (
      <span className={"text-sm " + (className ?? "")} style={{ textAlign: align }}>
        {value === "" || value === null || value === undefined
          ? <span className="text-muted-foreground/60 italic">{placeholder ?? "—"}</span>
          : (
            <>
              {String(value)}
              {suffix && <span className="text-muted-foreground ml-1 text-xs">{suffix}</span>}
            </>
          )}
      </span>
    );
  }

  if (!editing) {
    const empty = value === "" || value === null || value === undefined;
    return (
      <button
        type="button"
        data-testid={testId}
        onClick={() => setEditing(true)}
        className={
          "group inline-flex items-center gap-1 px-1.5 py-0.5 -mx-1.5 -my-0.5 rounded text-sm hover:bg-secondary transition-colors text-left max-w-full " +
          (className ?? "")
        }
        style={{ textAlign: align, justifyContent: align === "right" ? "flex-end" : align === "center" ? "center" : "flex-start" }}
      >
        <span className="truncate">
          {empty
            ? <span className="text-muted-foreground/60 italic">{placeholder ?? "tocca per modificare"}</span>
            : String(value)}
          {!empty && suffix && <span className="text-muted-foreground ml-1 text-xs">{suffix}</span>}
        </span>
      </button>
    );
  }

  // Editing mode
  return (
    <span className={"inline-flex items-center gap-1 " + (className ?? "")}>
      {options ? (
        <select
          ref={el => { inputRef.current = el; }}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") cancel();
          }}
          className={"px-1.5 py-0.5 text-sm bg-muted rounded outline-none focus:ring-2 focus:ring-primary/40 " + (inputClassName ?? "")}
        >
          {options.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      ) : (
        <input
          ref={el => { inputRef.current = el; }}
          type={type}
          inputMode={type === "number" ? "decimal" : undefined}
          step={type === "number" ? "any" : undefined}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") cancel();
          }}
          onBlur={commit}
          placeholder={placeholder}
          className={
            "px-1.5 py-0.5 text-sm bg-muted rounded outline-none focus:ring-2 focus:ring-primary/40 min-w-0 w-full " +
            (inputClassName ?? "")
          }
          style={{ textAlign: align }}
        />
      )}
      <button
        type="button"
        onMouseDown={e => e.preventDefault()}
        onClick={cancel}
        className="text-muted-foreground hover:text-foreground p-0.5"
        aria-label="Annulla"
      >
        <X className="w-3 h-3" />
      </button>
      {saving && <Check className="w-3 h-3 animate-pulse text-muted-foreground" />}
    </span>
  );
}
