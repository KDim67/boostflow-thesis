"use client";

import { AuthProvider } from "./useAuth";
import { OrganizationProvider } from "./OrganizationProvider";

export function FirebaseProvider({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <AuthProvider>
      <OrganizationProvider>{children}</OrganizationProvider>
    </AuthProvider>
  );
}
