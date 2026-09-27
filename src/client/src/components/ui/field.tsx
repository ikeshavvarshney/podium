import { cloneElement, useId, type ReactElement } from "react";

type ControlProps = { id?: string; "aria-describedby"?: string; "aria-invalid"?: boolean };

/**
 * A label, one form control and its hint or error, tied together with real
 * ids so screen readers announce the name, the hint and the invalid state.
 * Pass the control (input, textarea or select) as the only child; it keeps
 * its own styling.
 */
export function Field({
  label,
  hint,
  error,
  bordered = false,
  className = "",
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  /** A hairline under the field, as in the long organizer forms. */
  bordered?: boolean;
  className?: string;
  children: ReactElement<ControlProps>;
}) {
  const id = useId();
  const noteId = `${id}-note`;
  const note = error || hint;
  const control = cloneElement(children, {
    id,
    "aria-describedby": note ? noteId : undefined,
    "aria-invalid": error ? true : undefined,
  });
  const frame = bordered ? "border-b border-line py-4" : "";
  return (
    <div className={`grid gap-[7px] ${frame} ${className}`.trim()}>
      <label htmlFor={id} className="text-ui font-medium">
        {label}
      </label>
      {control}
      {note ? (
        <span
          id={noteId}
          className={error ? "text-small text-danger" : "text-small leading-[1.5] text-muted"}
        >
          {note}
        </span>
      ) : null}
    </div>
  );
}
