import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";
import { env } from "@/lib/env";

const key = () => new TextEncoder().encode(env.examTokenSecret);

export interface StudentClaims {
  typ: "student";
  sid: string; // student id
  tid: string; // terminal id
  m: "admission_no" | "name_search";
}
export interface AttemptClaims {
  typ: "attempt";
  aid: string;
  sid: string;
  tid: string;
}

export async function signStudent(c: Omit<StudentClaims, "typ">) {
  return new SignJWT({ ...c, typ: "student" }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("45m").sign(key());
}

/** Attempt tokens outlive the exam so answers saved offline can still be uploaded later. */
export async function signAttempt(c: Omit<AttemptClaims, "typ">, deadline: string) {
  const exp = Math.floor(Date.parse(deadline) / 1000) + 24 * 3600;
  return new SignJWT({ ...c, typ: "attempt" }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime(exp).sign(key());
}

export async function verify<T extends StudentClaims | AttemptClaims>(token: string | null, typ: T["typ"]): Promise<T | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] });
    return payload.typ === typ ? (payload as unknown as T) : null;
  } catch {
    return null;
  }
}

export function newTerminalToken() {
  return randomBytes(32).toString("base64url");
}
export function sha256(v: string) {
  return createHash("sha256").update(v).digest("hex");
}
