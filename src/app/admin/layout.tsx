import { AdminCenterFrame } from "@/components/admin-center-frame";
import { getCurrentSession } from "@/lib/auth";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getCurrentSession();

  return (
    <AdminCenterFrame
      email={session?.user.email}
      displayName={session?.user.displayName}
    >
      {children}
    </AdminCenterFrame>
  );
}
