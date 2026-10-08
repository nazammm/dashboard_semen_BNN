import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { DataSource } from '../lib/data';
import { logActivity } from '../lib/api';
import { formatSyncWhen, ROLE_LABEL } from '../lib/format';
import { PAGE_LABEL } from '../lib/pages';
import { NAV_GROUPS } from '../lib/pages';

function Icon({ d }: { d: string }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="w-[17px] h-[17px] shrink-0 opacity-85" dangerouslySetInnerHTML={{ __html: d }} />;
}

export default function Layout() {
  const { session, logout, pageAllowed } = useAuth();
  const loc = useLocation();
  const [sync, setSync] = useState<string | null>(null);
  const [syncNote, setSyncNote] = useState<string | undefined>();

  const groups = NAV_GROUPS.map(g => ({ ...g, items: g.items.filter(p => pageAllowed(p.id)) })).filter(g => g.items.length);
  const mobItems = groups.flatMap(g => g.items);

  useEffect(() => {
    DataSource.statusSync().then(s => { if (s) { setSync(formatSyncWhen(s)); setSyncNote(s.keterangan); } }).catch(() => {});
  }, []);

  // catat page_view + judul tab + scroll ke atas
  const pageId = loc.pathname.replace(/^\/+|\/+$/g, '') || 'beranda';
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
    document.title = `${PAGE_LABEL[pageId] || 'Dashboard'} — Dashboard Distribusi`;
    void logActivity('page_view', pageId);
  }, [pageId]);

  return (
    <>
      <nav className="hidden max-[880px]:flex fixed top-0 inset-x-0 h-14 bg-ink z-[100] items-center px-4 gap-3.5 overflow-x-auto border-b border-[#100f0c]" aria-label="Navigasi utama (mobile)">
        {mobItems.map(p => (
          <NavLink key={p.id} to={'/' + p.id} className={({ isActive }) => `font-mono text-[11.5px] tracking-wider whitespace-nowrap py-1.5 px-0.5 no-underline ${isActive ? 'text-accent' : 'text-[#C9C3B4]'}`}>{p.label}</NavLink>
        ))}
      </nav>

      <aside className="fixed top-0 left-0 bottom-0 w-sidebar bg-ink text-[#EDE9DF] flex flex-col z-[100] border-r border-[#100F0C] max-[880px]:hidden">
        <div className="px-[22px] pt-6 pb-5 border-b border-white/10 flex items-center gap-3.5">
          <img src="/assets/logo.svg" alt="Logo Perusahaan" className="w-14 h-14 object-contain shrink-0" onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
          <div className="font-extrabold text-xl text-white leading-tight" style={{ fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif', letterSpacing: '-.01em' }}>DASHBOARD<br />SEMEN</div>
        </div>
        <nav className="px-3 py-3.5 flex flex-col flex-1 overflow-y-auto" aria-label="Navigasi utama">
          {groups.map(g => (
            <div key={g.label} className="mb-3.5">
              <div className="font-mono text-[9.5px] uppercase text-[#847D6C] px-3 mb-[5px] font-semibold" style={{ letterSpacing: '.1em' }}>{g.label}</div>
              {g.items.map(p => (
                <NavLink key={p.id} to={'/' + p.id}
                  className={({ isActive }) => `flex items-center gap-3 px-3 py-[11px] rounded-sm no-underline text-[13.5px] font-medium border-l-2 transition-colors ${isActive ? 'bg-accent/15 text-white border-accent' : 'text-[#C9C3B4] border-transparent hover:bg-white/5 hover:text-white'}`}>
                  <Icon d={p.icon} /><span>{p.label}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="px-[22px] pt-4 pb-5 border-t border-white/10 font-mono text-[10px] text-[#847D6C] flex items-center gap-[7px]" style={{ letterSpacing: '.04em' }} title={syncNote}>
          <span className="w-1.5 h-1.5 rounded-full bg-green shrink-0" aria-hidden="true" />SYNC {sync || '–'}
        </div>
        <div className="px-[22px] pt-3 pb-[18px] flex items-center justify-between gap-2.5">
          <div className="min-w-0 flex-1">
            <div className="font-mono text-[11px] text-[#EDE9DF] truncate">{session?.name || '–'}</div>
            <div className="font-mono text-[9px] text-[#847D6C] uppercase mt-0.5" style={{ letterSpacing: '.08em' }}>{ROLE_LABEL[session?.role || ''] || session?.role}</div>
          </div>
          <button type="button" onClick={() => logout()} className="shrink-0 border border-white/20 bg-transparent text-[#C9C3B4] font-mono text-[10px] uppercase px-2.5 py-[5px] rounded-sm cursor-pointer hover:text-accent hover:border-accent transition-colors">Keluar</button>
        </div>
      </aside>

      <main className="ml-sidebar min-h-screen relative max-w-full max-[880px]:ml-0 max-[880px]:mt-14 max-[880px]:max-w-[100vw]">
        <div className="px-11 pt-10 pb-[90px] max-w-[1360px] max-[880px]:px-[18px] max-[880px]:pt-[26px] max-[880px]:pb-[70px]">
          <Outlet />
        </div>
      </main>
    </>
  );
}
export { Link };
