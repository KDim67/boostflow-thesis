"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/firebase/useAuth";
import { usePlatformAuth } from "@/lib/firebase/usePlatformAuth";
import { getUserProfile, UserProfile } from "@/lib/firebase/userProfileService";
import OrganizationSelector from "./navigation/OrganizationSelector";
import NotificationDropdown from "./navigation/NotificationDropdown";
import Image from "next/image";

/**
 * Main navigation component that adapts based on user authentication state and current route.
 * Provides responsive design with mobile menu, user profile management, and role-based access.
 */

const Navbar = () => {
  // UI state management
  const [isScrolled, setIsScrolled] = useState(false); // Tracks scroll position for navbar styling
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false); // Controls mobile menu visibility
  const [isProfileOpen, setIsProfileOpen] = useState(false); // Controls profile dropdown visibility
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null); // Stores user profile data

  // Navigation and routing
  const pathname = usePathname();
  const router = useRouter();

  // Authentication state
  const { user, logout, loading: authLoading } = useAuth();
  const { isPlatformModerator, isSuperAdmin } = usePlatformAuth();

  // Conditional UI state
  const [showOrgSelector, setShowOrgSelector] = useState(false); // Shows organization selector on specific routes

  // Fetch user profile data when user authentication state changes
  useEffect(() => {
    const fetchUserProfile = async () => {
      if (user?.uid) {
        try {
          const profile = await getUserProfile(user.uid);
          setUserProfile(profile);
        } catch (error) {
          console.error("Error fetching user profile:", error);
        }
      } else {
        setUserProfile(null);
      }
    };

    fetchUserProfile();
  }, [user]);

  // Listen for profile picture updates from other components
  useEffect(() => {
    const handleProfilePictureUpdate = (event: CustomEvent) => {
      if (userProfile) {
        setUserProfile((prev) =>
          prev
            ? {
                ...prev,
                profilePicture: event.detail.profilePicture,
              }
            : null
        );
      }
    };

    globalThis.addEventListener(
      "profilePictureUpdated",
      handleProfilePictureUpdate as EventListener
    );

    return () => {
      globalThis.removeEventListener(
        "profilePictureUpdated",
        handleProfilePictureUpdate as EventListener
      );
    };
  }, [userProfile]);

  // Determine if notifications should be shown based on user preferences (defaults to true)
  const showNotifications =
    userProfile?.settings?.notifications?.website ?? true;

  // Show organization selector only on dashboard and organization pages
  useEffect(() => {
    setShowOrgSelector(
      pathname.includes("/dashboard") || pathname.includes("/organizations")
    );
  }, [pathname]);

  // Close profile dropdown when clicking outside of it
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Element;
      if (isProfileOpen && !target.closest(".profile-dropdown")) {
        setIsProfileOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isProfileOpen]);

  // Track scroll position to apply background blur and shadow effects
  useEffect(() => {
    const handleScroll = () => {
      if (globalThis.scrollY > 10) {
        setIsScrolled(true);
      } else {
        setIsScrolled(false);
      }
    };

    globalThis.addEventListener("scroll", handleScroll);
    return () => globalThis.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <header className="fixed top-4 left-0 right-0 z-50 flex justify-center px-4">
      <div
        className={`w-full max-w-5xl transition-all duration-500 rounded-full backdrop-blur-xl ${
          isScrolled
            ? "bg-white/80 dark:bg-white/10 shadow-sm"
            : "bg-white/55 dark:bg-white/8"
        }`}
      >
        <div className="px-6 h-14 flex items-center justify-between">
          {/* Logo */}
          <Link href="/" className="flex items-center space-x-2">
            <Image
              src="/logo.png"
              alt="BoostFlow Logo"
              width={32}
              height={32}
              className="w-8 h-8"
            />
            <span className="text-xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
              BoostFlow
            </span>
          </Link>

          {/* Navigation Links */}
          <div className="hidden md:flex items-center space-x-8">
            {showOrgSelector && user ? (
              <OrganizationSelector />
            ) : (
              <>
                <Link
                  href="/"
                  className="text-gray-700 dark:text-gray-200 hover:text-blue-600 dark:hover:text-blue-400 font-medium transition-colors"
                >
                  Home
                </Link>
                <Link
                  href="/features"
                  className="text-gray-700 dark:text-gray-200 hover:text-blue-600 dark:hover:text-blue-400 font-medium transition-colors"
                >
                  Features
                </Link>
                <Link
                  href="/pricing"
                  className="text-gray-700 dark:text-gray-200 hover:text-blue-600 dark:hover:text-blue-400 font-medium transition-colors"
                >
                  Pricing
                </Link>
                <Link
                  href="/demo"
                  className="text-gray-700 dark:text-gray-200 hover:text-blue-600 dark:hover:text-blue-400 font-medium transition-colors"
                >
                  Demo
                </Link>
                <Link
                  href="/contact"
                  className="text-gray-700 dark:text-gray-200 hover:text-blue-600 dark:hover:text-blue-400 font-medium transition-colors"
                >
                  Contact
                </Link>
              </>
            )}
          </div>

          {/* CTA Buttons */}
          <div className="hidden md:flex items-center space-x-4">
            {user ? (
              <>
                {showNotifications && <NotificationDropdown />}

                <div className="relative profile-dropdown">
                  <button
                    onClick={() => setIsProfileOpen(!isProfileOpen)}
                    className="flex items-center space-x-2 p-1 rounded-full hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                  >
                    {userProfile?.profilePicture || userProfile?.photoURL ? (
                      <img
                        src={userProfile.profilePicture || userProfile.photoURL}
                        alt={user.displayName || user.email || "User"}
                        className="w-8 h-8 rounded-full object-cover border border-gray-200 dark:border-gray-700"
                      />
                    ) : (
                      <div className="w-8 h-8 bg-gradient-to-r from-blue-600 to-purple-600 rounded-full flex items-center justify-center text-white font-medium text-sm">
                        {user.displayName
                          ? user.displayName.charAt(0).toUpperCase()
                          : user.email?.charAt(0).toUpperCase()}
                      </div>
                    )}
                  </button>

                  {/* Profile Dropdown */}
                  {isProfileOpen && (
                    <div className="absolute right-0 mt-3 w-48 bg-white dark:bg-gray-800 rounded-xl shadow-xl py-2 z-50 border border-gray-100 dark:border-gray-700">
                      <Link
                        href="/settings"
                        className="block px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                        onClick={() => setIsProfileOpen(false)}
                      >
                        Settings
                      </Link>
                      <Link
                        href="/organizations"
                        className="block px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                        onClick={() => setIsProfileOpen(false)}
                      >
                        Workspace
                      </Link>
                      {(isPlatformModerator || isSuperAdmin) && (
                        <Link
                          href="/platform-admin"
                          className="block px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                          onClick={() => setIsProfileOpen(false)}
                        >
                          Admin Panel
                        </Link>
                      )}
                      <div className="my-1 border-t border-gray-100 dark:border-gray-700" />
                      <button
                        onClick={async () => {
                          await logout();
                          setIsProfileOpen(false);
                          router.push(`${globalThis.location.origin}/login`);
                        }}
                        className="block w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                      >
                        Logout
                      </button>
                    </div>
                  )}
                </div>
              </>
            ) : (
              !authLoading && (
                <>
                  <Link
                    href="/login"
                    className="text-gray-700 dark:text-gray-200 hover:text-blue-600 dark:hover:text-blue-400 font-medium transition-colors"
                  >
                    Login
                  </Link>
                  <Link
                    href="/signup"
                    className="bg-gradient-to-r from-blue-600 to-purple-600 text-white font-medium py-2 px-5 rounded-full hover:shadow-lg hover:scale-105 transition-all duration-200"
                  >
                    Start Free Trial
                  </Link>
                </>
              )
            )}
          </div>

          {/* Mobile Menu Button */}
          <button
            type="button"
            className="md:hidden p-2 rounded-full text-gray-700 dark:text-gray-200 hover:bg-black/5 dark:hover:bg-white/10"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          >
            <svg
              className="h-6 w-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              {isMobileMenuOpen ? (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              ) : (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 6h16M4 12h16M4 18h16"
                />
              )}
            </svg>
          </button>
        </div>

        {/* Mobile Menu */}
        {isMobileMenuOpen && (
          <div className="md:hidden border-t border-gray-200 dark:border-gray-800 p-4 bg-white/95 dark:bg-gray-900/95 backdrop-blur-lg rounded-b-3xl">
            <div className="space-y-1">
              {[
                "/ Home",
                "/features Features",
                "/pricing Pricing",
                "/demo Demo",
                "/contact Contact",
              ].map((item) => {
                const [href, ...rest] = item.split(" ");
                return (
                  <Link
                    key={href}
                    href={href}
                    className="block px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl font-medium transition-colors"
                    onClick={() => setIsMobileMenuOpen(false)}
                  >
                    {rest.join(" ")}
                  </Link>
                );
              })}
              <div className="pt-3 mt-2 border-t border-gray-100 dark:border-gray-800 space-y-1">
                {user ? (
                  <>
                    {showNotifications && (
                      <Link
                        href="/notifications"
                        className="block px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl font-medium transition-colors"
                        onClick={() => setIsMobileMenuOpen(false)}
                      >
                        Notifications
                      </Link>
                    )}
                    <Link
                      href="/settings"
                      className="block px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl font-medium transition-colors"
                      onClick={() => setIsMobileMenuOpen(false)}
                    >
                      Settings
                    </Link>
                    <Link
                      href="/organizations"
                      className="block px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl font-medium transition-colors"
                      onClick={() => setIsMobileMenuOpen(false)}
                    >
                      Workspace
                    </Link>
                    {(isPlatformModerator || isSuperAdmin) && (
                      <Link
                        href="/platform-admin"
                        className="block px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl font-medium transition-colors"
                        onClick={() => setIsMobileMenuOpen(false)}
                      >
                        Admin Panel
                      </Link>
                    )}
                    <button
                      onClick={async () => {
                        await logout();
                        setIsMobileMenuOpen(false);
                        router.push(`${globalThis.location.origin}/login`);
                      }}
                      className="block w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl font-medium transition-colors"
                    >
                      Logout
                    </button>
                  </>
                ) : (
                  !authLoading && (
                    <>
                      <Link
                        href="/login"
                        className="block px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl font-medium transition-colors"
                        onClick={() => setIsMobileMenuOpen(false)}
                      >
                        Login
                      </Link>
                      <Link
                        href="/signup"
                        className="block px-3 py-2 mt-1 text-sm bg-gradient-to-r from-blue-600 to-purple-600 text-white font-medium rounded-full text-center hover:shadow-md transition-all"
                        onClick={() => setIsMobileMenuOpen(false)}
                      >
                        Start Free Trial
                      </Link>
                    </>
                  )
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </header>
  );
};

export default Navbar;
