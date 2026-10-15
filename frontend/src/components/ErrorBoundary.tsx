import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Jaring pengaman: kalau satu halaman error saat dirender (atau file halamannya gagal dimuat setelah
 * aplikasi diperbarui), tampilkan pesan + tombol muat ulang, bukan layar putih kosong.
 */
export default class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean; chunk: boolean }> {
  state = { failed: false, chunk: false };

  static getDerivedStateFromError(error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return { failed: true, chunk: /dynamically imported module|Importing a module script failed|Loading chunk|error loading dynamically/i.test(msg) };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="error-box" role="alert">
        <strong>{this.state.chunk ? 'Aplikasi baru saja diperbarui.' : 'Halaman ini gagal ditampilkan.'}</strong>
        <div style={{ margin: '6px 0 10px' }}>
          {this.state.chunk ? 'Muat ulang halaman untuk memakai versi terbaru.' : 'Coba muat ulang. Kalau masih terjadi, hubungi admin.'}
        </div>
        <button type="button" className="btn" onClick={() => window.location.reload()}>Muat ulang</button>
      </div>
    );
  }
}
