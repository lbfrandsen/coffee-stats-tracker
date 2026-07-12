import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";

import type { Route } from "./+types/root";
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
} from "~/components/ui/navigation-menu";
import "./app.css";

export const links: Route.LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  {
    rel: "preconnect",
    href: "https://fonts.gstatic.com",
    crossOrigin: "anonymous",
  },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap",
  },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return (
    <div className="flex min-h-svh flex-col bg-zinc-950 text-zinc-50">
      <header className="border-b border-zinc-800 bg-zinc-950">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-center px-4 sm:px-6 lg:px-8">
          <h1 className="text-center text-xl font-semibold uppercase tracking-[0.4em] text-zinc-100">
            KAFFEMÆNDENE
          </h1>
        </div>
      </header>

      <nav
        className="border-b border-zinc-800 bg-zinc-900/70"
        aria-label="Main navigation"
      >
        <div className="mx-auto flex h-12 max-w-6xl items-center justify-center px-2 sm:px-4 lg:px-6">
          <NavigationMenu>
            <NavigationMenuList className="gap-5">
              <NavigationMenuItem>
                <NavigationMenuLink
                  href="/"
                  className="px-3 font-medium text-zinc-300 hover:bg-zinc-800 hover:text-zinc-50 focus:bg-zinc-800 focus:text-zinc-50"
                >
                  Home
                </NavigationMenuLink>
              </NavigationMenuItem>
              <NavigationMenuItem>
                <NavigationMenuLink
                  href="/info"
                  className="px-3 font-medium text-zinc-300 hover:bg-zinc-800 hover:text-zinc-50 focus:bg-zinc-800 focus:text-zinc-50"
                >
                  Info
                </NavigationMenuLink>
              </NavigationMenuItem>
              <NavigationMenuItem>
                <NavigationMenuLink
                  href="/status"
                  className="px-3 font-medium text-zinc-300 hover:bg-zinc-800 hover:text-zinc-50 focus:bg-zinc-800 focus:text-zinc-50"
                >
                  Raspberry Pi Status
                </NavigationMenuLink>
              </NavigationMenuItem>
            </NavigationMenuList>
          </NavigationMenu>
        </div>
      </nav>
      <main className="flex-1">
        <Outlet />
      </main>
      <footer className="border-t border-zinc-800 bg-zinc-950">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-center px-4 text-sm text-zinc-500 sm:px-6 lg:px-8">
          © {new Date().getFullYear()} Lucas Bjerg Frandsen. All rights
          reserved.
        </div>
      </footer>
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Oops!";
  let details = "An unexpected error occurred.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "Error";
    details =
      error.status === 404
        ? "The requested page could not be found."
        : error.statusText || details;
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main className="pt-16 p-4 container mx-auto">
      <h1>{message}</h1>
      <p>{details}</p>
      {stack && (
        <pre className="w-full p-4 overflow-x-auto">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
