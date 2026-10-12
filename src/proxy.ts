import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PROTECTED = ["/workspace", "/onboarding", "/studio", "/library", "/credits"];
const DEV_COOKIE = "dukaanshot_dev_session";

/**
 * Refreshes the Supabase session cookie on every page navigation and sends
 * signed-out users to /login for app pages. API routes do their own auth.
 */
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isProtected = PROTECTED.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  let response = NextResponse.next({ request });
  let signedIn: boolean;

  if (process.env.AUTH_PROVIDER === "dev") {
    // Presence check only; the signature is verified server-side on every API call.
    signedIn = Boolean(request.cookies.get(DEV_COOKIE)?.value);
  } else {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anon) return response;
    const supabase = createServerClient(url, anon, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    });
    const { data } = await supabase.auth.getUser();
    signedIn = Boolean(data.user);
  }

  if (isProtected && !signedIn) {
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    login.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(login);
  }
  if (pathname === "/login" && signedIn) {
    const home = request.nextUrl.clone();
    home.pathname = "/workspace";
    home.search = "";
    return NextResponse.redirect(home);
  }
  return response;
}

export const config = {
  matcher: ["/((?!api|auth/callback|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|ico)$).*)"],
};
