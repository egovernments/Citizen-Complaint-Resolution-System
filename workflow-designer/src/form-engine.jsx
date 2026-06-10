// =====================================================================
// FormEngine — renders a form from a JSON-Schema-like config.
// Supports: string (with enum), text (textarea), number, boolean,
// multi (multi-select), duration (SLA), assignee, datetime.
// =====================================================================

import React, { useState, useEffect, useRef, useMemo } from 'react';

// -- Custom dropdown matching the terminal aesthetic -------------------
function Dropdown({ value, options, onChange, placeholder = "— select —",
                   renderOption, variant = "field", className = "" }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    function onDoc(e) { if (!rootRef.current?.contains(e.target)) setOpen(false); }
    function onKey(e) { if (e.key === "Escape") setOpen(false); }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const opts = options.map(o => typeof o === "string" ? { value: o, label: o } : o);
  const sel = opts.find(o => o.value === value);

  const trigger = variant === "chip" ? (
    <button type="button" className="chip-add dd-trigger"
            onClick={() => setOpen(o => !o)}>
      + add
    </button>
  ) : (
    <button type="button" className={"dd-trigger" + (open ? " open" : "")}
            onClick={() => setOpen(o => !o)}>
      <span className={sel ? "" : "dd-placeholder"}>
        {sel ? (renderOption ? renderOption(sel) : sel.label) : placeholder}
      </span>
      <span className="dd-caret">▾</span>
    </button>
  );

  return (
    <div className={"dropdown " + variant + " " + className} ref={rootRef}>
      {trigger}
      {open && (
        <div className="dd-menu">
          {opts.length === 0 && <div className="dd-empty">No options</div>}
          {opts.map(o => (
            <div key={o.value} className={"dd-item" + (o.value === value ? " selected" : "")}
                 onClick={() => { onChange(o.value); setOpen(false); }}>
              <span className="dd-mark">{o.value === value ? "●" : ""}</span>
              <span>{renderOption ? renderOption(o) : o.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Field({ name, schema, value, onChange, users }) {
  const label = schema.title || name;
  const req = schema.required;

  const labelNode = (
    <label className="field-label">
      {label}{req && <span className="req">*</span>}
    </label>
  );

  const help = schema.help ? <div className="field-help">{schema.help}</div> : null;

  // Enum -> custom dropdown
  if (schema.type === "string" && Array.isArray(schema.enum)) {
    return (
      <div className="field">
        {labelNode}
        <Dropdown value={value || ""} options={schema.enum}
                  onChange={v => onChange(v)} placeholder="— select —" />
        {help}
      </div>
    );
  }

  if (schema.type === "string") {
    return (
      <div className="field">
        {labelNode}
        <input className="input" type="text" value={value ?? ""} maxLength={schema.maxLength}
               onChange={e => onChange(e.target.value)} />
        {help}
      </div>
    );
  }

  if (schema.type === "text") {
    return (
      <div className="field">
        {labelNode}
        <textarea className="textarea" value={value ?? ""} onChange={e => onChange(e.target.value)} />
        {help}
      </div>
    );
  }

  if (schema.type === "number") {
    return (
      <div className="field">
        {labelNode}
        <input className="input" type="number" value={value ?? ""} min={schema.min} max={schema.max} step={schema.step ?? 1}
               onChange={e => onChange(e.target.value === "" ? null : Number(e.target.value))} />
        {help}
      </div>
    );
  }

  if (schema.type === "boolean") {
    return (
      <div className="field">
        <label className="checkbox-row">
          <input type="checkbox" checked={!!value} onChange={e => onChange(e.target.checked)} />
          <span className="cb-label">{label}</span>
        </label>
        {help}
      </div>
    );
  }

  if (schema.type === "multi") {
    const current = Array.isArray(value) ? value : [];
    const remaining = (schema.options || []).filter(o => !current.includes(o));
    return (
      <div className="field">
        {labelNode}
        <div className="multi-chips">
          {current.map(v => (
            <span key={v} className="chip">
              {v}
              <span className="x" onClick={() => onChange(current.filter(x => x !== v))}>×</span>
            </span>
          ))}
          {remaining.length > 0 && (
            <Dropdown variant="chip" value="" options={remaining}
                      onChange={v => { if (v) onChange([...current, v]); }} />
          )}
        </div>
        {help}
      </div>
    );
  }

  if (schema.type === "duration") {
    const v = value ?? { value: null, unit: "hours" };
    const isNone = v == null || v.value == null;
    return (
      <div className="field">
        {labelNode}
        <div className="duration-row">
          <input className="input" type="number" min="0" value={isNone ? "" : v.value}
                 placeholder="none"
                 onChange={e => {
                   const n = e.target.value;
                   if (n === "") { onChange(null); return; }
                   onChange({ value: Number(n), unit: v.unit || "hours" });
                 }} />
          <Dropdown value={v.unit || "hours"}
                    options={[
                      {value: "minutes", label: "min"},
                      {value: "hours",   label: "hrs"},
                      {value: "days",    label: "days"},
                      {value: "weeks",   label: "wks"},
                    ]}
                    onChange={u => onChange({ value: v.value ?? 1, unit: u })} />
        </div>
        {help}
      </div>
    );
  }

  if (schema.type === "assignee") {
    return <AssigneeField label={labelNode} value={value} onChange={onChange} users={users} help={help} />;
  }

  if (schema.type === "datetime") {
    return (
      <div className="field">
        {labelNode}
        <input className="input" type="datetime-local" value={value ?? ""}
               onChange={e => onChange(e.target.value)} />
        {help}
      </div>
    );
  }

  return null;
}

function AssigneeField({ label, value, onChange, users, help }) {
  const [open, setOpen] = useState(false);
  const user = users.find(u => u.id === value);
  const rootRef = useRef(null);
  useEffect(() => {
    function onDoc(e) { if (!rootRef.current?.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  const initials = (u) => u.name.split(/\s+/).map(x => x[0]).slice(0,2).join("");
  return (
    <div className="field" ref={rootRef}>
      {label}
      <div className="assignee-picker">
        <div className="assignee-selected" onClick={() => setOpen(o => !o)}>
          {user ? (
            <>
              <span className="avatar">{initials(user)}</span>
              <span>{user.name}</span>
              <span style={{marginLeft: "auto", color: "var(--text-faint)", fontSize: 10}}>{user.role}</span>
              <span className="x" style={{color: "var(--text-faint)", marginLeft: 6}}
                    onClick={(e) => { e.stopPropagation(); onChange(null); setOpen(false); }}>×</span>
            </>
          ) : (
            <span style={{color: "var(--text-faint)"}}>— unassigned —</span>
          )}
        </div>
        {open && (
          <div className="assignee-menu">
            {users.map(u => (
              <div key={u.id} className="assignee-item"
                   onClick={() => { onChange(u.id); setOpen(false); }}>
                <span className="avatar">{initials(u)}</span>
                <span>{u.name}</span>
                <span className="role">{u.role}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      {help}
    </div>
  );
}

export function FormEngine({ schema, value, onChange, users }) {
  const order = schema.order || Object.keys(schema.properties);
  return (
    <div>
      {order.map(name => {
        const field = schema.properties[name];
        if (!field) return null;
        return (
          <Field key={name} name={name} schema={field}
                 value={value?.[name]} users={users}
                 onChange={(v) => onChange({ ...value, [name]: v })} />
        );
      })}
    </div>
  );
}
