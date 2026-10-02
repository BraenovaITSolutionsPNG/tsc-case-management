import { useAuth } from "@/_core/hooks/useAuth";
import { OrganisationLogos } from "@/components/OrganisationLogos";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { useIsMobile } from "@/hooks/useMobile";
import {
  ClipboardList,
  FilePlus2,
  LayoutDashboard,
  Loader2,
  LogOut,
  PanelLeft,
  ShieldCheck,
} from "lucide-react";
import { CSSProperties, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { DashboardLayoutSkeleton } from "./DashboardLayoutSkeleton";
import { Button } from "./ui/button";
import { can, canAny, type Capability } from "@shared/access";
import type { Role } from "@shared/roles";
import { Settings, Wrench } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "./ui/command";

/**
 * Navigation, gated on the capability the destination actually needs rather than
 * on a rank. A plain administrator has oversight rights but no system statistics,
 * so the menu hides the platform section from them instead of offering a link
 * that returns a refusal - the same rule `requireCapability` applies server-side.
 */
const menuItems: {
  icon: typeof LayoutDashboard;
  label: string;
  path: string;
  /** Omitted means every signed-in officer may open it. */
  requires?: Capability;
  /** Held-in-any is the alternative: the item opens if the role holds one. */
  requiresAny?: readonly Capability[];
}[] = [
  { icon: LayoutDashboard, label: "Overview", path: "/" },
  { icon: ClipboardList, label: "Case register", path: "/cases" },
  {
    icon: FilePlus2,
    label: "Register matter",
    path: "/cases/new",
    requires: "matter:register",
  },
  {
    icon: ShieldCheck,
    label: "Reports",
    path: "/reports",
    requires: "report:view",
  },
  { icon: Settings, label: "Settings", path: "/settings" },
  // Any of the four platform capabilities opens this screen, not just
  // platform:users: the tabs behind it are gated individually, and the
  // Administrator tier holds platform:oversight.
  {
    icon: Wrench,
    label: "Administration",
    path: "/admin",
    requiresAny: [
      "platform:users",
      "platform:oversight",
      "platform:audit",
      "platform:stats",
    ],
  },
];

function permittedItems(role: Role | undefined) {
  return menuItems.filter(item => {
    if (item.requiresAny) return canAny(role, item.requiresAny);
    return !item.requires || can(role, item.requires);
  });
}

const SIDEBAR_WIDTH_KEY = "sidebar-width";
const DEFAULT_WIDTH = 280;
const MIN_WIDTH = 200;
const MAX_WIDTH = 480;

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // The sidebar width is remembered per browser. Read inside a `typeof window`
  // guard because this initializer also runs while the server is rendering,
  // where `localStorage` does not exist and reading it throws — which fails the
  // prerender of every page that renders inside this layout. The server always
  // renders the default width; the effect below corrects it on the client.
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    if (typeof window === "undefined") return DEFAULT_WIDTH;
    const saved = window.localStorage.getItem(SIDEBAR_WIDTH_KEY);
    const parsed = saved ? parseInt(saved, 10) : NaN;
    return Number.isFinite(parsed) ? parsed : DEFAULT_WIDTH;
  });
  const { loading, user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_WIDTH_KEY, sidebarWidth.toString());
    } catch {
      // Storage unavailable: the width simply is not remembered.
    }
  }, [sidebarWidth]);

  // A signed-out officer is sent to the sign-in page rather than shown a second
  // one here. This used to render its own "Sign in to continue" panel with a
  // button that called `startLogin()` — which meant there were two different
  // sign-in screens, and neither could reach the username/password form: the
  // button threw whenever the identity provider was unconfigured. One sign-in
  // page, at /login, is the only place credentials are entered.
  useEffect(() => {
    if (loading || user) return;
    router.replace(
      pathname ? `/login?next=${encodeURIComponent(pathname)}` : "/login"
    );
  }, [loading, user, pathname, router]);

  if (loading) {
    return <DashboardLayoutSkeleton />;
  }

  if (!user) {
    // The redirect above is already in flight; this is what it looks like for
    // the moment before the route changes.
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Taking you to the sign-in page…
        </div>
      </div>
    );
  }

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": `${sidebarWidth}px`,
        } as CSSProperties
      }
    >
      <DashboardLayoutContent setSidebarWidth={setSidebarWidth}>
        {children}
      </DashboardLayoutContent>
    </SidebarProvider>
  );
}

type DashboardLayoutContentProps = {
  children: React.ReactNode;
  setSidebarWidth: (width: number) => void;
};

function DashboardLayoutContent({
  children,
  setSidebarWidth,
}: DashboardLayoutContentProps) {
  const { user, logout } = useAuth();
  // wouter returned a `[path, navigate]` pair; App Router splits it.
  const location = usePathname();
  const router = useRouter();
  const { state, toggleSidebar } = useSidebar();
  const isCollapsed = state === "collapsed";
  const [isResizing, setIsResizing] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const permitted = permittedItems(user?.role);
  const activeMenuItem = permitted.find(item => item.path === location);
  const isMobile = useIsMobile();

  useEffect(() => {
    if (isCollapsed) {
      setIsResizing(false);
    }
  }, [isCollapsed]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;

      const sidebarLeft = sidebarRef.current?.getBoundingClientRect().left ?? 0;
      const newWidth = e.clientX - sidebarLeft;
      if (newWidth >= MIN_WIDTH && newWidth <= MAX_WIDTH) {
        setSidebarWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing, setSidebarWidth]);

  return (
    <>
      <div className="relative" ref={sidebarRef}>
        <Sidebar
          collapsible="icon"
          className="border-r-0"
          disableTransition={isResizing}
        >
          {/* Auto height, not the h-16 it used to be: the header now carries the
              wordmark row *and* the logo row, and a fixed 64px clipped the
              title off the top of the sidebar. */}
          <SidebarHeader className="h-auto justify-center">
            <div className="flex items-center gap-3 px-2 transition-all w-full">
              <button
                onClick={toggleSidebar}
                className="h-8 w-8 flex items-center justify-center hover:bg-accent rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring shrink-0"
                aria-label="Toggle navigation"
              >
                <PanelLeft className="h-4 w-4 text-muted-foreground" />
              </button>
              {!isCollapsed ? (
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-semibold tracking-tight truncate">
                    TSC Provincial Matters
                  </span>
                </div>
              ) : null}
            </div>
            {!isCollapsed ? (
              <div className="px-3 pb-3 pt-1" aria-label="Organisation logos">
                <OrganisationLogos markClassName="h-12 flex-1" />
              </div>
            ) : null}
          </SidebarHeader>

          <SidebarContent className="gap-0">
            <SidebarMenu className="px-2 py-1">
              {permitted.map(item => {
                const isActive = location === item.path;
                return (
                  <SidebarMenuItem key={item.path}>
                    <SidebarMenuButton
                      isActive={isActive}
                      onClick={() => router.push(item.path)}
                      tooltip={item.label}
                      className={`h-10 transition-all font-normal`}
                    >
                      <item.icon
                        className={`h-4 w-4 ${isActive ? "text-primary" : ""}`}
                      />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarContent>

          <SidebarFooter className="p-3">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-3 rounded-lg px-1 py-1 hover:bg-accent/50 transition-colors w-full text-left group-data-[collapsible=icon]:justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <Avatar className="h-9 w-9 border shrink-0">
                    {/*
                     * The officer's photo when they have uploaded one, and their
                     * initial when they have not. This block was the initial alone,
                     * so an officer who had set a photo on the settings screen
                     * still saw "J" here — the two screens disagreed about who
                     * they were, and the sidebar is the one present on every page.
                     *
                     * A plain img through the storage proxy rather than
                     * next/image, for the reason in AvatarUpload: the proxy
                     * answers with a signed redirect and sets the content type, so
                     * there is no optimisable asset to hand the optimiser.
                     */}
                    {user?.avatarKey ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={`/files/${user.avatarKey}`}
                        alt={
                          user.name ? `${user.name}'s photo` : "Officer photo"
                        }
                        width={36}
                        height={36}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <AvatarFallback className="text-xs font-medium">
                        {user?.name?.charAt(0).toUpperCase()}
                      </AvatarFallback>
                    )}
                  </Avatar>
                  <div className="flex-1 min-w-0 group-data-[collapsible=icon]:hidden">
                    <p className="text-sm font-medium truncate leading-none">
                      {user?.name || "-"}
                    </p>
                    <p className="text-xs text-muted-foreground truncate mt-1.5">
                      {user?.email || "-"}
                    </p>
                  </div>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem
                  onClick={logout}
                  className="cursor-pointer text-destructive focus:text-destructive"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>Sign out</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarFooter>
        </Sidebar>
        <div
          className={`absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-primary/20 transition-colors ${isCollapsed ? "hidden" : ""}`}
          onMouseDown={() => {
            if (isCollapsed) return;
            setIsResizing(true);
          }}
          style={{ zIndex: 50 }}
        />
      </div>

      <SidebarInset>
        {isMobile && (
          <div className="flex border-b h-14 items-center justify-between bg-background/95 px-2 backdrop-blur supports-[backdrop-filter]:backdrop-blur sticky top-0 z-40">
            <div className="flex items-center gap-2">
              <SidebarTrigger className="h-9 w-9 rounded-lg bg-background" />
              <div className="flex items-center gap-3">
                <div className="flex flex-col gap-1">
                  <span className="tracking-tight text-foreground">
                    {activeMenuItem?.label ?? "Menu"}
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPaletteOpen(true)}
                  className="h-8 gap-2 text-xs text-muted-foreground"
                >
                  Go to
                  <kbd className="rounded border bg-muted px-1 font-sans text-[10px]">
                    ⌘K
                  </kbd>
                </Button>
              </div>
              <div
                className="flex items-center gap-1.5"
                aria-label="Organisation logos"
              >
                <OrganisationLogos
                  markClassName="h-8 w-11"
                  sizes="48px"
                  width={48}
                  height={36}
                />
              </div>
            </div>
          </div>
        )}
        <main className="flex-1 p-4">{children}</main>
      </SidebarInset>

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        items={permitted}
        onNavigate={path => {
          setPaletteOpen(false);
          router.push(path);
        }}
      />
    </>
  );
}

/**
 * ⌘K navigation. The list is the same capability-filtered set the sidebar shows,
 * so the two can never disagree about what this officer may open.
 */
function CommandPalette({
  open,
  onOpenChange,
  items,
  onNavigate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: { icon: typeof LayoutDashboard; label: string; path: string }[];
  onNavigate: (path: string) => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Go to"
      description="Jump to a section of the platform."
      className="sm:max-w-lg"
    >
      <CommandInput placeholder="Type a section name…" />
      <CommandList>
        <CommandEmpty>No matching section.</CommandEmpty>
        <CommandGroup heading="Navigate">
          {items.map(item => (
            <CommandItem
              key={item.path}
              value={`${item.label} ${item.path}`}
              onSelect={() => onNavigate(item.path)}
            >
              <item.icon className="mr-2 h-4 w-4" />
              {item.label}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
