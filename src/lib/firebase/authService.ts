/**
 * Firebase Authentication Service
 *
 * This module provides a centralized interface for all authentication operations
 * in the BoostFlow application. It wraps Firebase Auth methods with error handling
 * and consistent configuration.
 */

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  updateProfile,
  onAuthStateChanged,
  signInWithPopup,
  GoogleAuthProvider,
  sendEmailVerification,
  User,
  UserCredential,
} from "firebase/auth";
import { auth } from "./config";
import { logAuditEvent } from "@/lib/services/auditClient";

// Configure Google OAuth provider
const googleProvider = new GoogleAuthProvider();
// Force account selection dialog to appear even if user has only one Google account
// This ensures users can switch between multiple Google accounts
googleProvider.setCustomParameters({
  prompt: "select_account",
});

/**
 * Registers a new user with email and password
 *
 * @param email - User's email address
 * @param password - User's password (must meet Firebase requirements)
 * @param displayName - Optional display name to set on the user profile
 * @returns Promise resolving to UserCredential containing user info and auth tokens
 *
 * @throws FirebaseError if registration fails (weak password, email in use, etc.)
 */
export const registerUser = async (
  email: string,
  password: string,
  displayName?: string
): Promise<UserCredential> => {
  try {
    const userCredential = await createUserWithEmailAndPassword(
      auth,
      email,
      password
    );

    // Set display name if provided and user creation was successful
    if (displayName && userCredential.user) {
      await updateProfile(userCredential.user, { displayName });
    }

    void logAuditEvent({
      type: "auth.register",
      outcome: "success",
      userEmail: email,
      user: userCredential.user,
    });

    return userCredential;
  } catch (error) {
    console.error("Error registering user:", error);
    void logAuditEvent({
      type: "auth.register",
      outcome: "failure",
      userEmail: email,
      reason: (error as { code?: string })?.code,
    });
    throw error; // Re-throw to allow caller to handle specific error cases
  }
};

/**
 * Authenticates a user with email and password
 *
 * @param email - User's email address
 * @param password - User's password
 * @returns Promise resolving to UserCredential with user info and auth tokens
 *
 * @throws FirebaseError if login fails (invalid credentials, user not found, etc.)
 */
export const loginUser = async (
  email: string,
  password: string
): Promise<UserCredential> => {
  try {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    void logAuditEvent({
      type: "auth.login.success",
      outcome: "success",
      userEmail: email,
      user: cred.user,
    });
    return cred;
  } catch (error) {
    console.error("Error logging in:", error);
    void logAuditEvent({
      type: "auth.login.failure",
      outcome: "failure",
      userEmail: email,
      reason: (error as { code?: string })?.code,
    });
    throw error; // Re-throw to allow caller to handle specific error cases
  }
};

/**
 * Signs out the current user
 *
 * Clears the user's authentication state and tokens from the client.
 * This will trigger auth state change listeners.
 *
 * @returns Promise that resolves when sign out is complete
 * @throws FirebaseError if sign out fails (rare, usually network issues)
 */
export const logoutUser = async (): Promise<void> => {
  try {
    const current = auth.currentUser;
    await signOut(auth);
    void logAuditEvent({
      type: "auth.logout",
      outcome: "success",
      userEmail: current?.email ?? null,
    });
  } catch (error) {
    console.error("Error logging out:", error);
    throw error;
  }
};

/**
 * Sends a password reset email to the user
 *
 * The email will contain a link that redirects to our auth handler page
 * where the user can set a new password.
 *
 * @param email - Email address to send reset link to
 * @returns Promise that resolves when email is sent
 *
 * @throws FirebaseError if email sending fails (invalid email, user not found, etc.)
 */
export const resetPassword = async (email: string): Promise<void> => {
  try {
    // Configure where the password reset link should redirect
    const actionCodeSettings = {
      url: `${process.env.NEXT_PUBLIC_APP_URL || "https://boostflow-thesis.me"}/auth-handler/auth/action`,
      handleCodeInApp: true, // Handle the reset within our app rather than external browser
    };

    await sendPasswordResetEmail(auth, email, actionCodeSettings);
    void logAuditEvent({
      type: "auth.password_reset_requested",
      outcome: "success",
      userEmail: email,
    });
  } catch (error) {
    console.error("Error resetting password:", error);
    void logAuditEvent({
      type: "auth.password_reset_requested",
      outcome: "failure",
      userEmail: email,
      reason: (error as { code?: string })?.code,
    });
    throw error;
  }
};

/**
 * Gets the currently authenticated user
 *
 * This is a synchronous operation that returns the cached user state.
 * For real-time auth state changes, use subscribeToAuthChanges instead.
 *
 * @returns Current user object or null if not authenticated
 */
export const getCurrentUser = (): User | null => {
  return auth.currentUser;
};

/**
 * Authenticates user with Google OAuth using popup flow.
 *
 * @returns Promise resolving to UserCredential with user info and auth tokens
 * @throws FirebaseError if OAuth flow fails (popup blocked, user cancels, etc.)
 */
export const signInWithGoogle = async (): Promise<UserCredential> => {
  try {
    const cred = await signInWithPopup(auth, googleProvider);
    void logAuditEvent({
      type: "auth.login.success",
      outcome: "success",
      userEmail: cred.user.email,
      user: cred.user,
      metadata: { provider: "google" },
    });
    return cred;
  } catch (error) {
    const code = (error as { code?: string })?.code;
    if (
      code === "auth/popup-closed-by-user" ||
      code === "auth/cancelled-popup-request" ||
      code === "user-cancelled"
    ) {
      throw error;
    }
    console.error("Error signing in with Google:", error);
    void logAuditEvent({
      type: "auth.login.failure",
      outcome: "failure",
      reason: code,
      metadata: { provider: "google" },
    });
    throw error;
  }
};

/**
 * Sends an email verification link to the user
 *
 * The verification email will contain a link that redirects to our auth handler
 * page where the email verification will be processed.
 *
 * @param user - Firebase User object to send verification email to
 * @returns Promise that resolves when verification email is sent
 *
 * @throws FirebaseError if email sending fails or user is already verified
 */
export const sendVerificationEmail = async (user: User): Promise<void> => {
  try {
    // Configure where the verification link should redirect
    const actionCodeSettings = {
      url: `${process.env.NEXT_PUBLIC_APP_URL || "https://boostflow-thesis.me"}/auth-handler/auth/action`,
      handleCodeInApp: true, // Handle verification within our app
    };

    await sendEmailVerification(user, actionCodeSettings);
  } catch (error) {
    console.error("Error sending verification email:", error);
    throw error;
  }
};

/**
 * Subscribes to authentication state changes
 *
 * The callback will be invoked whenever the user's authentication state changes
 * (login, logout, token refresh, etc.). This is the recommended way to track
 * auth state in React components.
 *
 * @param callback - Function to call when auth state changes
 * @returns Unsubscribe function to stop listening to auth changes
 *
 */
export const subscribeToAuthChanges = (
  callback: (user: User | null) => void
) => {
  return onAuthStateChanged(auth, callback);
};
