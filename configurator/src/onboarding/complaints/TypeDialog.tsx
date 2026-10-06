import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { hasMixedHours, type DraftType } from './complaintsApi';
import { chosenHours, formatHours, initialChoice, RESOLUTION_CHOICES, type HoursChoice } from './resolution';

/**
 * Add or edit one complaint type: its name, the department that handles it,
 * its subtypes, one per line, and its resolution time. Editing keeps each
 * existing subtype's code by matching it on its name.
 */
export function TypeDialog({
  open,
  type,
  departments,
  takenNames,
  defaultHours,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  type?: DraftType;
  departments: { code: string; name: string }[];
  /** Other types' names, compared ignoring case. */
  takenNames: string[];
  /** The workspace's default resolution time, for a type without its own. */
  defaultHours: number;
  onOpenChange: (open: boolean) => void;
  onSave: (type: DraftType) => void;
}) {
  const id = useId();
  const [name, setName] = useState('');
  const [department, setDepartment] = useState('');
  const [subtypes, setSubtypes] = useState('');
  const [hoursChoice, setHoursChoice] = useState<HoursChoice>('default');
  const [customHours, setCustomHours] = useState('');
  const [errors, setErrors] = useState<{ name?: string; department?: string; subtypes?: string; hours?: string }>({});

  const [openedFor, setOpenedFor] = useState<string | null>(null);
  const openKey = open ? type?.code ?? type?.name ?? '(new)' : null;
  if (openKey !== openedFor) {
    setOpenedFor(openKey);
    if (openKey) {
      setName(type?.name ?? '');
      setDepartment(type?.department ?? (departments.length === 1 ? departments[0].code : ''));
      setSubtypes((type?.subtypes ?? []).map((sub) => sub.name).join('\n'));
      const initial = initialChoice(type);
      setHoursChoice(initial.choice);
      setCustomHours(initial.custom);
      setErrors({});
    }
  }

  const save = () => {
    const trimmed = name.trim();
    const lines = subtypes.split('\n').map((line) => line.trim()).filter(Boolean);
    const next: typeof errors = {};
    if (!trimmed) next.name = 'Give the complaint category a name.';
    else if (takenNames.some((taken) => taken.toLowerCase() === trimmed.toLowerCase())) next.name = `“${trimmed}” is already on the list.`;
    if (!department) next.department = 'Choose the department that handles it.';
    const seen = new Set<string>();
    for (const line of lines) {
      const key = line.toLowerCase();
      if (seen.has(key)) {
        next.subtypes = `“${line}” is listed twice.`;
        break;
      }
      seen.add(key);
    }
    const hours = chosenHours(hoursChoice, customHours, type);
    if ('error' in hours) next.hours = hours.error;
    setErrors(next);
    if ('error' in hours || Object.keys(next).length) return;

    const { slaHours, keepOwn } = hours;
    const previous = new Map((type?.subtypes ?? []).map((sub) => [sub.name.toLowerCase(), sub]));
    onSave({
      code: type?.code,
      name: trimmed,
      department,
      subtypes: lines.map((line) => {
        const before = previous.get(line.toLowerCase());
        return { code: before?.code, name: line, ...(keepOwn && before?.slaHours !== undefined && { slaHours: before.slaHours }) };
      }),
      ...(slaHours !== undefined && { slaHours }),
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{type ? 'Edit complaint category' : 'Add a complaint category'}</DialogTitle>
          <DialogDescription>
            A category is the broad group someone picks when reporting. Subcategories sit under it.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <div className="space-y-1.5">
            <label htmlFor={`${id}-name`} className="block text-sm font-medium text-foreground">Name</label>
            <Input id={`${id}-name`} value={name} autoFocus placeholder="Street lighting" onChange={(event) => setName(event.target.value)} />
            {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
          </div>
          <div className="space-y-1.5">
            <label htmlFor={`${id}-department`} className="block text-sm font-medium text-foreground">Handled by</label>
            <Select value={department} onValueChange={setDepartment}>
              <SelectTrigger id={`${id}-department`} className="bg-card">
                <SelectValue placeholder="Choose a department" />
              </SelectTrigger>
              <SelectContent>
                {departments.map((choice) => (
                  <SelectItem key={choice.code} value={choice.code}>
                    {choice.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.department && <p className="text-xs text-destructive">{errors.department}</p>}
          </div>
          <div className="space-y-1.5">
            <label htmlFor={`${id}-subtypes`} className="block text-sm font-medium text-foreground">
              Subcategories <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <textarea
              id={`${id}-subtypes`}
              rows={4}
              value={subtypes}
              placeholder={'One per line\nBroken lamp\nFlickering lamp'}
              onChange={(event) => setSubtypes(event.target.value)}
              className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <p className={`text-xs ${errors.subtypes ? 'text-destructive' : 'text-muted-foreground'}`}>
              {errors.subtypes ?? 'One per line. You can add more later.'}
            </p>
          </div>
          <div className="space-y-1.5">
            <label htmlFor={`${id}-hours`} className="block text-sm font-medium text-foreground">Resolution time</label>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={hoursChoice} onValueChange={(value) => setHoursChoice(value as HoursChoice)}>
                <SelectTrigger id={`${id}-hours`} className="w-auto min-w-[12rem] bg-card">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">Default ({formatHours(defaultHours)})</SelectItem>
                  {RESOLUTION_CHOICES.map((choice) => (
                    <SelectItem key={choice.hours} value={`${choice.hours}`}>
                      {choice.label}
                    </SelectItem>
                  ))}
                  <SelectItem value="custom">Other, in hours</SelectItem>
                  {type && hasMixedHours(type) && <SelectItem value="mixed">Keep each subcategory’s own time</SelectItem>}
                </SelectContent>
              </Select>
              {hoursChoice === 'custom' && (
                <Input
                  type="number"
                  min={1}
                  inputMode="numeric"
                  aria-label="Resolution time in hours"
                  placeholder="Hours"
                  value={customHours}
                  onChange={(event) => setCustomHours(event.target.value)}
                  className="h-9 w-24 bg-card"
                />
              )}
            </div>
            <p className={`text-xs ${errors.hours ? 'text-destructive' : 'text-muted-foreground'}`}>
              {errors.hours ?? 'How long complaints in this category have before they show as overdue.'}
            </p>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">{type ? 'Save changes' : 'Add category'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
