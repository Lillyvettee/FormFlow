import { useEffect, useState } from "react";
import { useLocation, Link } from "wouter";
import { LayoutDashboard, FileText, BarChart3, LinkIcon, Package, Settings, LogOut, Image, MessageSquare, DollarSign, Clock, Users, Inbox, ScanLine } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useOrganization } from "@/hooks/use-organization";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { AppLogo } from "@/components/app-logo";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
  SidebarHeader,
} from "@/components/ui/sidebar";
import { supabase } from "@/lib/supabase";
import { usePeopleAccess } from "@/lib/people-access";
import { useIsStaff } from "@/hooks/use-is-staff";

const navItems = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Forms", url: "/forms", icon: FileText },
  { title: "Reports", url: "/reports", icon: BarChart3 },
  { title: "Links", url: "/links", icon: LinkIcon },
  { title: "Inventory", url: "/inventory", icon: Package },
  { title: "Media", url: "/media", icon: Image },
];

const phase2Items = [
  { title: "Donations", url: "/donations", icon: DollarSign },
  { title: "Volunteer Hours", url: "/volunteer-hours", icon: Clock },
  { title: "People", url: "/people", icon: Users },
  { title: "Scan", url: "/scan", icon: ScanLine },
];

const bottomItems = [
  { title: "Settings", url: "/settings", icon: Settings },
  { title: "Feedback", url: "/feedback", icon: MessageSquare },
];

export function AppSidebar() {
  const [location] = useLocation();
  const { user } = useAuth();
  const { branding } = useOrganization();
  // People is hidden for roles the organization doesn't let see it (migration 015).
  const { canView: canViewPeople } = usePeopleAccess();
  // HumMotion staff also get the Inbox (migration 017).
  const { isStaff } = useIsStaff();
  const footerItems = isStaff ? [...bottomItems, { title: "Inbox", url: "/admin", icon: Inbox }] : bottomItems;
  // Fall back to the HumMotion logo if the organization's logo link is broken.
  const [logoFailed, setLogoFailed] = useState(false);
  useEffect(() => setLogoFailed(false), [branding.logoUrl]);
  const showLogo = Boolean(branding.logoUrl) && !logoFailed;

  const fullName = user?.user_metadata?.full_name ?? "";
  const email = user?.email ?? "";

  const getInitials = () => {
    if (fullName.trim()) {
      const parts = fullName.trim().split(" ");
      return parts.map((p: string) => p[0]).join("").toUpperCase().slice(0, 2);
    }
    return email[0]?.toUpperCase() ?? "U";
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    window.location.href = "/";
  };

  const isActive = (url: string) => url === "/" ? location === "/" : location.startsWith(url);

  return (
    <Sidebar>
      <SidebarHeader className="p-4">
        <div className="flex items-center gap-2.5 min-w-0">
          {showLogo ? (
            <img
              src={branding.logoUrl ?? undefined}
              alt=""
              className="h-8 w-8 rounded-md object-contain shrink-0"
              onError={() => setLogoFailed(true)}
            />
          ) : (
            <AppLogo className="h-8 w-8" />
          )}
          <span className="font-semibold text-base tracking-tight truncate" data-testid="text-sidebar-title">
            HumMotion
          </span>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Main</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild isActive={isActive(item.url)}>
                    <Link href={item.url} data-testid={`link-nav-${item.title.toLowerCase()}`}>
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Impact Tracking</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {phase2Items.filter((item) => item.url !== "/people" || canViewPeople).map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild isActive={isActive(item.url)}>
                    <Link href={item.url} data-testid={`link-nav-${item.title.toLowerCase().replace(" ", "-")}`}>
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {footerItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild isActive={isActive(item.url)}>
                    <Link href={item.url}>
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-3">
        <div className="flex items-center gap-3 p-2 rounded-md">
          <Avatar className="h-8 w-8 shrink-0">
            <AvatarFallback className="text-xs bg-primary text-primary-foreground">
              {getInitials()}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate" data-testid="text-user-name">{fullName || email}</p>
            <p className="text-xs text-muted-foreground truncate" data-testid="text-user-email">{email}</p>
          </div>
          <button
            onClick={handleLogout}
            title="Sign out"
            data-testid="button-logout"
            className="h-8 w-8 flex items-center justify-center rounded-md hover:bg-muted transition-colors shrink-0"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
