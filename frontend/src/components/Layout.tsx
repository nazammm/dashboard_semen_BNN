import { useEffect } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { logActivity } from '../lib/api';
import { ROLE_LABEL } from '../lib/format';
import { DataStatusPanel } from './DataStatus';
import { PAGE_LABEL } from '../lib/pages';
import { NAV_GROUPS } from '../lib/pages';

function Icon({ d }: { d: string }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="w-[17px] h-[17px] shrink-0 opacity-85" dangerouslySetInnerHTML={{ __html: d }} />;
}

export default function Layout() {
  const { session, logout, pageAllowed } = useAuth();
  const loc = useLocation();

  const groups = NAV_GROUPS.map(g => ({ ...g, items: g.items.filter(p => pageAllowed(p.id)) })).filter(g => g.items.length);
  const mobItems = groups.flatMap(g => g.items);

  // catat page_view + judul tab + scroll ke atas
  const pageId = loc.pathname.replace(/^\/+|\/+$/g, '') || 'beranda';
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
    document.title = `${PAGE_LABEL[pageId] || 'Dashboard'} · Dashboard Semen`;
    void logActivity('page_view', pageId);
  }, [pageId]);

  return (
    <>
      <nav className="hidden max-[880px]:flex fixed top-0 inset-x-0 h-14 bg-surface z-[100] items-center px-4 gap-4 overflow-x-auto border-b border-line" aria-label="Navigasi utama (mobile)">
        <img src={`${import.meta.env.BASE_URL}assets/logo.svg`} alt="" className="w-8 h-8 object-contain shrink-0" onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
        {mobItems.map(p => (
          <NavLink key={p.id} to={'/' + p.id} className={({ isActive }) => `text-[13px] whitespace-nowrap py-[17px] no-underline border-b-2 ${isActive ? 'text-ink font-semibold border-mark' : 'text-soft border-transparent'}`}>{p.label}</NavLink>
        ))}
      </nav>

      <aside className="fixed top-0 left-0 bottom-0 w-sidebar bg-surface text-ink flex flex-col z-[100] border-r border-line max-[880px]:hidden">
        <div className="px-5 pt-5 pb-4 flex items-center gap-3">
          <img src={`${import.meta.env.BASE_URL}assets/logo.svg`} alt="Logo Perusahaan" className="w-10 h-10 object-contain shrink-0" onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
          <div className="font-semibold text-[15px] text-ink leading-tight">Dashboard Semen</div>
        </div>
        <nav className="px-3 pb-3 flex flex-col flex-1 min-h-0 overflow-y-auto" aria-label="Navigasi utama">
          {groups.map(g => (
            <div key={g.label} className="mt-3">
              <div className="text-[12px] font-medium text-faint px-3 mb-1">{g.label}</div>
              {g.items.map(p => (
                <NavLink key={p.id} to={'/' + p.id}
                  className={({ isActive }) => `relative flex items-center gap-3 px-3 py-2 rounded-sm no-underline text-[13.5px] transition-colors ${isActive ? 'bg-accent-soft text-accent-ink font-semibold before:content-[""] before:absolute before:left-0 before:top-2 before:bottom-2 before:w-[3px] before:rounded-full before:bg-mark' : 'text-soft hover:bg-surface2 hover:text-ink'}`}>
                  <Icon d={p.icon} /><span>{p.label}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <DataStatusPanel />
        <div className="px-5 pt-3 pb-4 border-t border-line flex items-center justify-between gap-2.5">
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium text-ink truncate">{session?.name || '–'}</div>
            <div className="text-[12px] text-faint mt-0.5">{ROLE_LABEL[session?.role || ''] || session?.role}</div>
          </div>
          <button type="button" onClick={() => logout()} className="btn btn-sm shrink-0">Keluar</button>
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
