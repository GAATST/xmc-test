import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import './dam-picker.css';

export const metadata: Metadata = {
  title: 'DAM Picker',
  robots: { index: false, follow: false },
};

// Evaluate the kill switch per request, not at build time.
export const dynamic = 'force-dynamic';

export default function DamPickerLayout({ children }: { children: React.ReactNode }) {
  // Kill switch: on deployments that don't host authoring (e.g. the public
  // delivery site), DAM_PICKER_ENABLED=false removes the picker UI entirely —
  // the /api/dam/* routes 404 through the same switch in apiGuard.ts.
  if (process.env.DAM_PICKER_ENABLED === 'false') {
    notFound();
  }
  return <div className="dam-picker">{children}</div>;
}
