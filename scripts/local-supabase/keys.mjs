// Prints anon and service_role keys (HS256 JWTs) for the local JWT secret.
import { SignJWT } from "jose";
const secret = new TextEncoder().encode(process.env.JWT_SECRET);
const exp = Math.floor(Date.now() / 1000) + 10 * 365 * 24 * 3600;
for (const role of ["anon", "service_role"]) {
  const jwt = await new SignJWT({ role, iss: "supabase-local" }).setProtectedHeader({ alg: "HS256", typ: "JWT" }).setExpirationTime(exp).sign(secret);
  console.log(`${role === "anon" ? "NEXT_PUBLIC_SUPABASE_ANON_KEY" : "SUPABASE_SERVICE_ROLE_KEY"}=${jwt}`);
}
