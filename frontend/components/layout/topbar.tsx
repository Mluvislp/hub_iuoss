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
    <header
      className="sticky top-0 z-30 h-14 flex items-center gap-3 px-5
                 bg-white/80 backdrop-blur-md
                 border-b border-slate-200/80"
    >
      <button
        onClick={onMenuClick}
        className="lg:hidden p-1.5 rounded-lg text-slate-500
                   hover:text-slate-700 hover:bg-slate-100 transition-colors"
      >
        <Menu size={20} />
      </button>

      <span className="font-semibold text-slate-800 text-[0.925rem]">{title}</span>

      <div className="ml-auto flex items-center gap-2">
        {session && (
          <span className="flex items-center gap-1.5 text-xs font-medium
                           bg-slate-100 text-slate-600 px-3 py-1.5 rounded-full
                           border border-slate-200">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
            {session.student_code}
          </span>
        )}
      </div>
    </header>
  );
}
