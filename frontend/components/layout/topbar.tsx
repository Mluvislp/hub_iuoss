'use client';

import { Menu } from 'lucide-react';
import type { StudentSession } from '@/lib/types';

interface TopbarProps {
  title: string;
  session: StudentSession | null;
  onMenuClick: () => void;
}

export default function Topbar({ title, session, onMenuClick }: TopbarProps) {
  return (
    <header className="sticky top-0 z-30 h-[56px] flex items-center gap-3 px-5
                       bg-white border-b border-line">
      <button
        onClick={onMenuClick}
        className="lg:hidden -ml-1 p-1.5 rounded-md text-muted hover:text-ink hover:bg-slate-100"
        aria-label="Mở menu"
      >
        <Menu size={20} />
      </button>

      <h1 className="text-[0.95rem] font-semibold text-ink">{title}</h1>

      {session && (
        <div className="ml-auto flex items-center gap-2 text-sm">
          <span className="text-muted hidden sm:inline">Mã số sinh viên</span>
          <span className="font-medium text-ink bg-slate-100 border border-slate-300 rounded-md
                           px-2.5 py-1 font-mono text-[0.8rem]">
            {session.student_code}
          </span>
        </div>
      )}
    </header>
  );
}
