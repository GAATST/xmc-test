import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import './dam-picker.css';

export const metadata: Metadata = {
  title: 'DAM Picker',
  robots: { index: false, follow: false },
};

export default function DamPickerLayout({ children }: { children: React.ReactNode }) {
  // Kill switch: on deployments that don't host authoring (e.g. the public
  // delivery site), DAM_PICKER_ENABLED=false removes the picker UI entirely —
  // the /api/dam/* routes 404 through the same switch in apiGuard.ts.
  //
  // Evaluated when the (static) page is rendered at build/deploy time — no
  // `export const dynamic` here on purpose: the XM Cloud editing-host build
  // pipeline mishandled route segment config (500 / DYNAMIC_SERVER_USAGE).
  // Changing the env var therefore requires a redeploy, which is fine for a
  // per-deployment switch.
  if (process.env.DAM_PICKER_ENABLED === 'false') {
    notFound();
  }
  return <div className="dam-picker">{children}</div>;
}
