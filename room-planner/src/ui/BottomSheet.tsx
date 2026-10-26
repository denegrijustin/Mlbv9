import type { ReactNode } from 'react'
import { Icon } from './kit'

export function BottomSheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  return (
    <div
      className={`fixed inset-x-0 bottom-0 z-40 flex max-h-[64vh] flex-col rounded-t-3xl border border-line bg-solid shadow-float transition-transform duration-200 ${open ? 'translate-y-0' : 'translate-y-full'}`}
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      role="dialog"
      aria-label={title}
      aria-hidden={!open}
    >
      <div className="flex shrink-0 items-center justify-between px-4 pb-1 pt-2">
        <div className="mx-auto h-1 w-9 rounded-full bg-[var(--line-strong)]" />
      </div>
      <div className="flex shrink-0 items-center justify-between px-4 pb-2">
        <div className="text-[15px] font-semibold">{title}</div>
        <button type="button" onClick={onClose} aria-label="Close" className="flex h-8 w-8 items-center justify-center rounded-full bg-fill"><Icon name="close" size={16} /></button>
      </div>
      <div className="thin-scroll min-h-0 flex-1 overflow-y-auto">{open && children}</div>
    </div>
  )
}
