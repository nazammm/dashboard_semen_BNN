import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, ROLE_HOME, useAuth } from './lib/auth';
import Layout from './components/Layout';
import { PageSkeleton, ErrorBox } from './components/ui';
import Login from './pages/Login';

const pages: Record<string, ReturnType<typeof lazy>> = {
  beranda: lazy(() => import('./pages/Beranda')),
  'performa-daerah': lazy(() => import('./pages/PerformaDaerah')),
  delivery: lazy(() => import('./pages/Delivery')),
  'rekap-harian': lazy(() => import('./pages/RekapHarian')),
  'tim-sales': lazy(() => import('./pages/TimSales')),
  'peta-toko': lazy(() => import('./pages/PetaToko')),
  'daftar-toko': lazy(() => import('./pages/DaftarToko')),
  'transaksi-detail': lazy(() => import('./pages/TransaksiDetail')),
  'toko-detail': lazy(() => import('./pages/TokoDetail')),
  'interaksi-web': lazy(() => import('./pages/InteraksiWeb')),
  'kelola-akses': lazy(() => import('./pages/KelolaAkses')),
};

function Guard() {
  const { session, pageAllowed } = useAuth();
  const loc = useLocation();
  if (!session) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  return <Layout />;
}

/** Gerbang UX per halaman; penolakan data yang sebenarnya tetap dilakukan server. */
function PageGate({ id }: { id: string }) {
  const { session, pageAllowed } = useAuth();
  if (!session) return null;
  if (!pageAllowed(id)) {
    const home = ROLE_HOME[session.role].slice(1);
    const target = pageAllowed(home) ? home : pageAllowed('beranda') ? 'beranda' : null;
    return target ? <Navigate to={'/' + target} replace /> : <ErrorBox error="Akun ini belum diberi akses ke halaman manapun. Hubungi admin." />;
  }
  const Page = pages[id];
  return <Suspense fallback={<PageSkeleton />}><Page /></Suspense>;
}

function Home() {
  const { session } = useAuth();
  return <Navigate to={session ? ROLE_HOME[session.role] : '/login'} replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<Guard />}>
            <Route path="/" element={<Home />} />
            {Object.keys(pages).map(id => <Route key={id} path={'/' + id} element={<PageGate id={id} />} />)}
            <Route path="*" element={<Home />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
