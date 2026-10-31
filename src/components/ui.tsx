import * as Dialog from '@radix-ui/react-dialog';
import * as Dropdown from '@radix-ui/react-dropdown-menu';
import { AlertCircle, CheckCircle2, ChevronLeft, ChevronRight, Loader2, Search, X } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useId,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { ApiError } from '../lib/api';
import { number } from '../lib/format';

export const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

// Buttons

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-white hover:bg-accent-hover border-transparent',
  secondary: 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50',
  ghost: 'bg-transparent text-slate-600 border-transparent hover:bg-slate-100',
  danger: 'bg-white text-rose-700 border-rose-200 hover:bg-rose-50',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  loading?: boolean;
  icon?: ReactNode;
}

export function Button({ variant = 'secondary', loading, icon, children, className, disabled, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={cx(
        'inline-flex h-8 items-center justify-center gap-1.5 rounded-md border px-2.5 text-[13px] font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}

export function IconButton({ label, children, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button type="button" aria-label={label} title={label} className={cx('inline-flex size-8 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800', className)} {...rest}>
      {children}
    </button>
  );
}

// Form controls

const CONTROL = 'h-8 w-full rounded-md border border-slate-200 bg-white px-2.5 text-[13px] text-slate-900 placeholder:text-slate-400 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:bg-slate-50 disabled:text-slate-500';

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx(CONTROL, className)} {...rest} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx(CONTROL, 'pr-6', className)} {...rest}>
      {children}
    </select>
  );
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx(CONTROL, 'h-auto min-h-16 py-1.5', className)} {...rest} />;
}

export function Field({ label, error, hint, children, className }: { label: string; error?: string; hint?: string; children: (id: string) => ReactNode; className?: string }) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-slate-600">
        {label}
      </label>
      {children(id)}
      {error ? <p className="mt-1 text-xs text-rose-700">{error}</p> : hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

export function Checkbox({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-start gap-2">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 size-3.5 accent-accent" />
      <span>
        <span className="block text-[13px] text-slate-800">{label}</span>
        {hint && <span className="block text-xs text-slate-500">{hint}</span>}
      </span>
    </label>
  );
}

export function SearchInput({ value, onChange, placeholder, className }: { value: string; onChange: (value: string) => void; placeholder: string; className?: string }) {
  return (
    <div className={cx('relative', className)}>
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-slate-400" aria-hidden />
      <input type="search" aria-label={placeholder} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={cx(CONTROL, 'pl-8')} />
    </div>
  );
}

export function FormError({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : 'Something went wrong';
  return (
    <div role="alert" className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-2.5 py-2 text-xs text-rose-700">
      <AlertCircle className="mt-px size-3.5 shrink-0" aria-hidden />
      {message}
    </div>
  );
}

export const fieldErrors = (error: unknown): Record<string, string> => (error instanceof ApiError && error.fields ? error.fields : {});

// Surfaces

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('rounded-lg border border-slate-200 bg-white', className)}>{children}</div>;
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-lg font-semibold tracking-tight text-slate-900">{title}</h1>
        {description && <p className="mt-0.5 text-[13px] text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

const TONES = {
  emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  sky: 'bg-sky-50 text-sky-700 border-sky-200',
  amber: 'bg-amber-50 text-amber-700 border-amber-200',
  slate: 'bg-slate-100 text-slate-700 border-slate-200',
  rose: 'bg-rose-50 text-rose-700 border-rose-200',
  indigo: 'bg-accent-soft text-accent border-indigo-200',
};
export type Tone = keyof typeof TONES;

export function Badge({ tone = 'slate', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cx('inline-flex items-center gap-1 rounded border px-1.5 py-px text-[11px] font-medium whitespace-nowrap', TONES[tone], className)}>{children}</span>;
}

export function Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: Array<{ value: T; label: string; count?: number }>; value: T; onChange: (value: T) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="flex gap-1 overflow-x-auto border-b border-slate-200">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          role="tab"
          type="button"
          aria-selected={value === tab.value}
          onClick={() => onChange(tab.value)}
          className={cx(
            '-mb-px flex h-9 shrink-0 items-center gap-1.5 border-b-2 px-2.5 text-[13px] font-medium transition-colors',
            value === tab.value ? 'border-accent text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-800',
          )}
        >
          {tab.label}
          {tab.count !== undefined && <span className="num rounded bg-slate-100 px-1 text-[11px] text-slate-600">{number(tab.count)}</span>}
        </button>
      ))}
    </div>
  );
}

// Tables

export const TH = 'h-8 border-b border-slate-200 bg-slate-50/70 px-3 text-left text-[11px] font-medium tracking-wide whitespace-nowrap text-slate-500 uppercase';
export const TD = 'border-b border-slate-100 px-3 py-2 align-middle';

export function Pagination({ page, pageSize, total, onPage, children }: { page: number; pageSize: number; total: number; onPage: (page: number) => void; children?: ReactNode }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-3 py-2 text-xs text-slate-500">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span>
          <span className="num text-slate-700">
            {number(from)}–{number(to)}
          </span>{' '}
          of <span className="num text-slate-700">{number(total)}</span>
        </span>
        {children}
      </div>
      <div className="flex items-center gap-1">
        <IconButton label="Previous page" className="size-7 disabled:cursor-not-allowed disabled:opacity-40" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          <ChevronLeft className="size-4" />
        </IconButton>
        <span className="num px-1 text-slate-700">
          {number(page)} / {number(pages)}
        </span>
        <IconButton label="Next page" className="size-7 disabled:cursor-not-allowed disabled:opacity-40" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          <ChevronRight className="size-4" />
        </IconButton>
      </div>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('animate-pulse rounded bg-slate-100', className)} />;
}

export function TableSkeleton({ rows = 8, columns = 6 }: { rows?: number; columns?: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, r) => (
        <tr key={r}>
          {Array.from({ length: columns }, (_, c) => (
            <td key={c} className={TD}>
              <Skeleton className="h-3.5 w-full max-w-28" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      {icon && <div className="mb-2 text-slate-400">{icon}</div>}
      <p className="text-[13px] font-medium text-slate-800">{title}</p>
      {description && <p className="mt-1 max-w-sm text-xs text-slate-500">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <EmptyState
      icon={<AlertCircle className="size-5 text-rose-500" />}
      title="This could not be loaded"
      description={error instanceof Error ? error.message : undefined}
      action={onRetry && <Button onClick={onRetry}>Try again</Button>}
    />
  );
}

// Overlays

export function Modal({ open, onClose, title, description, children, footer, wide }: { open: boolean; onClose: () => void; title: string; description?: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="animate-fade-in fixed inset-0 z-50 bg-slate-900/25" />
        <Dialog.Content
          {...(description ? {} : { 'aria-describedby': undefined })}
          className={cx('animate-pop-in fixed top-[6vh] left-1/2 z-50 flex max-h-[88vh] w-[calc(100vw-2rem)] -translate-x-1/2 flex-col rounded-lg border border-slate-200 bg-white', wide ? 'max-w-3xl' : 'max-w-md')}
        >
          <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
            <div>
              <Dialog.Title className="text-sm font-semibold text-slate-900">{title}</Dialog.Title>
              {description && <Dialog.Description className="mt-0.5 text-xs text-slate-500">{description}</Dialog.Description>}
            </div>
            <Dialog.Close asChild>
              <IconButton label="Close" className="size-7">
                <X className="size-4" />
              </IconButton>
            </Dialog.Close>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-3">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 px-4 py-3">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function Drawer({ open, onClose, label, children }: { open: boolean; onClose: () => void; label: string; children: ReactNode }) {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="animate-fade-in fixed inset-0 z-40 bg-slate-900/20" />
        <Dialog.Content aria-describedby={undefined} className="animate-slide-in fixed inset-y-0 right-0 z-40 flex w-full max-w-[860px] flex-col border-l border-slate-200 bg-white">
          <Dialog.Title className="sr-only">{label}</Dialog.Title>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function ConfirmDialog({ open, onClose, title, description, confirmLabel, danger, onConfirm, loading, error, children }: {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  loading?: boolean;
  error?: unknown;
  children?: ReactNode;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button onClick={onClose}>Keep as is</Button>
          <Button variant={danger ? 'danger' : 'primary'} loading={loading} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-[13px] text-slate-600">{description}</p>
      {children && <div className="mt-3">{children}</div>}
      {Boolean(error) && (
        <div className="mt-3">
          <FormError error={error} />
        </div>
      )}
    </Modal>
  );
}

export const Menu = {
  Root: Dropdown.Root,
  Trigger: Dropdown.Trigger,
  Content({ children, align = 'end' }: { children: ReactNode; align?: 'start' | 'end' }) {
    return (
      <Dropdown.Portal>
        <Dropdown.Content align={align} sideOffset={4} onClick={(e) => e.stopPropagation()} className="animate-pop-in z-50 min-w-44 rounded-md border border-slate-200 bg-white p-1 shadow-sm">
          {children}
        </Dropdown.Content>
      </Dropdown.Portal>
    );
  },
  Item({ children, onSelect, icon, danger, disabled }: { children: ReactNode; onSelect?: () => void; icon?: ReactNode; danger?: boolean; disabled?: boolean }) {
    return (
      <Dropdown.Item
        disabled={disabled}
        onSelect={onSelect}
        className={cx(
          'flex h-7 cursor-pointer items-center gap-2 rounded px-2 text-[13px] outline-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40 data-[highlighted]:bg-slate-100',
          danger ? 'text-rose-700' : 'text-slate-700',
        )}
      >
        {icon}
        {children}
      </Dropdown.Item>
    );
  },
  Separator() {
    return <Dropdown.Separator className="my-1 h-px bg-slate-100" />;
  },
};

// Toasts

type ToastTone = 'success' | 'error';
const ToastContext = createContext<(message: string, tone?: ToastTone) => void>(() => undefined);
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Array<{ id: number; message: string; tone: ToastTone }>>([]);
  const nextId = useRef(0);
  const push = useCallback((message: string, tone: ToastTone = 'success') => {
    const id = ++nextId.current;
    setToasts((list) => [...list, { id, message, tone }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), tone === 'error' ? 7000 : 4000);
  }, []);
  const value = useMemo(() => push, [push]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div aria-live="polite" className="no-print fixed right-4 bottom-4 z-[60] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
        {toasts.map((t) => (
          <div key={t.id} className="animate-pop-in flex items-start gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-800 shadow-sm">
            {t.tone === 'success' ? <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-600" aria-hidden /> : <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-rose-600" aria-hidden />}
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
