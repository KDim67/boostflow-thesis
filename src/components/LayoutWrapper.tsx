"use client";

import { usePathname } from "next/navigation";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { useSuspensionCheck } from "@/lib/hooks/useSuspensionCheck";

interface LayoutWrapperProps {
  children: React.ReactNode;
}

/**
 * Layout wrapper component that conditionally renders navigation and footer
 * based on the current route. Handles different layout requirements for
 * admin panels, auth pages, and regular application pages.
 */
export default function LayoutWrapper({
  children,
}: Readonly<LayoutWrapperProps>) {
  const pathname = usePathname();

  // Route detection for conditional layout rendering
  const isAdminPanel = pathname?.startsWith("/platform-admin");
  const isSuspendedPage = pathname === "/suspended";
  const isAuthPage = pathname === "/login" || pathname === "/signup";

  // Skip suspension checks for pages that don't require user authentication
  const shouldCheckSuspension = !isSuspendedPage && !isAuthPage;
  useSuspensionCheck(shouldCheckSuspension);

  // Define full-bleed marketing/auth pages where background should bleed to the top under the floating pill
  const isFullBleedPage =
    pathname === "/" ||
    pathname === "/features" ||
    pathname === "/pricing" ||
    pathname === "/contact" ||
    pathname === "/demo" ||
    pathname === "/about" ||
    pathname === "/careers" ||
    pathname === "/privacy-policy" ||
    pathname === "/terms-of-service" ||
    pathname === "/documentation" ||
    pathname === "/login" ||
    pathname === "/signup" ||
    pathname?.startsWith("/forgot-password") ||
    pathname?.startsWith("/verify-email") ||
    pathname?.startsWith("/auth-handler") ||
    pathname === "/suspended";

  // Determine main element CSS classes based on layout rules
  let mainClassName = "flex-grow";
  if (isAdminPanel) {
    mainClassName = "";
  } else if (!isFullBleedPage) {
    mainClassName = "flex-grow pt-28";
  }

  return (
    <>
      {/* Hide navbar on admin panel pages */}
      {!isAdminPanel && <Navbar />}
      <main className={mainClassName}>{children}</main>
      {/* Hide footer on admin panel pages */}
      {!isAdminPanel && <Footer />}
    </>
  );
}
