"use client";

import { useEffect, useState } from "react";

const CSRF_COOKIE_NAME = "csrf_token";

function readCsrfCookie(): string {
  if (typeof document === "undefined") return "";
  const match = document.cookie
    .split("; ")
    .find((row) => row.startsWith(`${CSRF_COOKIE_NAME}=`));
  return match ? decodeURIComponent(match.split("=")[1]) : "";
}

export default function CsrfHiddenInput() {
  const [token, setToken] = useState("");

  useEffect(() => {
    setToken(readCsrfCookie());
  }, []);

  return <input type="hidden" name="csrf_token" value={token} readOnly />;
}
