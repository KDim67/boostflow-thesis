import { useState, useEffect } from "react";
import { User } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db as firestore } from "./config";

// Platform-specific user roles for access control
export type PlatformRole = "super_admin" | "platform_moderator" | "user";

// Extended Firebase User interface with platform-specific properties
interface PlatformAuthUser extends User {
  platformRole?: PlatformRole;
}

// Return type for the usePlatformAuth hook
export interface UsePlatformAuthReturn {
  user: PlatformAuthUser | null;
  isPlatformAdmin: boolean;
  isSuperAdmin: boolean;
  isPlatformModerator: boolean;
  isLoading: boolean;
  error: Error | null;
}

/**
 * Custom hook for platform authentication with role-based access control
 * Manages user authentication state and platform roles
 */
export function usePlatformAuth(): UsePlatformAuthReturn {
  const [user, setUser] = useState<PlatformAuthUser | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  // Computed role-based access flags
  const isPlatformAdmin =
    !!user &&
    (user.platformRole === "super_admin" ||
      user.platformRole === "platform_moderator");

  const isSuperAdmin = !!user && user.platformRole === "super_admin";
  const isPlatformModerator =
    !!user && user.platformRole === "platform_moderator";

  useEffect(() => {
    setIsLoading(true);

    // Listen for authentication state changes
    const unsubscribe = auth.onAuthStateChanged(async (authUser) => {
      try {
        if (authUser) {
          // Fetch user's platform role from Firestore
          const userDoc = await getDoc(doc(firestore, "users", authUser.uid));
          const userData = userDoc.data();

          // Enhance Firebase user with platform-specific properties
          const platformUser: PlatformAuthUser = authUser;
          platformUser.platformRole =
            (userData?.platformRole as PlatformRole) || "user";

          setUser(platformUser);
        } else {
          setUser(null);
        }
      } catch (err) {
        setError(
          err instanceof Error ? err : new Error("Unknown authentication error")
        );
        setUser(null);
      } finally {
        setIsLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  return {
    user,
    isPlatformAdmin,
    isSuperAdmin,
    isPlatformModerator,
    isLoading,
    error,
  };
}
