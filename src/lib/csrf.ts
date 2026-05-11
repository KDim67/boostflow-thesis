import { NextRequest } from "next/server";

export const CSRF_COOKIE_NAME = "csrf_token";
export const CSRF_FIELD_NAME = "csrf_token";
export const CSRF_HEADER_NAME = "x-csrf-token";

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.codePointAt(i) ^ b.codePointAt(i);
  }
  return mismatch === 0;
}

export function verifyCsrf(
  request: NextRequest,
  submittedToken: string | null | undefined
): boolean {
  const cookieToken = request.cookies.get(CSRF_COOKIE_NAME)?.value;
  if (!cookieToken || !submittedToken) return false;
  return timingSafeEqual(cookieToken, submittedToken);
}
