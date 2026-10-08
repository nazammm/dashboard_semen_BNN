/** Baris data dari API (kolom view/fungsi database: bentuknya longgar karena skema ada di database). */
export type Row = Record<string, any>;

export type Role = 'admin' | 'mo' | 'sales' | 'spv';
export interface PagePerm { can_view_detail: boolean; can_download: boolean }

export interface Session {
  access_token: string;
  expires_at: number; // detik epoch
  role: Role;
  username: string;
  name: string;
  dist_code: string | null;
  pages: string[];
  pagePermissions: Record<string, PagePerm>;
}
