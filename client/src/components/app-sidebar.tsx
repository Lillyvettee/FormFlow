import { useLocation, Link } from "wouter";
import { LayoutDashboard, FileText, BarChart3, LinkIcon, Package, Settings, LogOut, Heart } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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

const navItems = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Forms", url: "/forms", icon: FileText },
  { title: "Reports", url: "/reports", icon: BarChart3 },
  { title: "Links", url: "/links", icon: LinkIcon },
  { title: "Inventory", url: "/inventory", icon: Package },
  { title: "Settings", url: "/settings", icon: Settings },
];

export function AppSidebar() {
  const [location] = useLocation();
  const { user } = useAuth();

  const getInitials = () => {
    const f = user?.firstName?.[0] || "";
    const l = user?.lastName?.[0] || "";
    return (f + l).toUpperCase() || "U";
  };

  return (
    <Sidebar>
      <SidebarHeader className="p-4">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-md bg-primary flex items-center justify-center shrink-0">
            <Heart className="h-4 w-4 text-primary-foreground" />
          </div>
          <span className="font-semibold text-base tracking-tight" data-testid="text-sidebar-title">FormFlow</span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => {
                const isActive = item.url === "/" ? location === "/" : location.startsWith(item.url);
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild isActive={isActive}>
                      <Link href={item.url} data-testid={`link-nav-${item.title.toLowerCase()}`}>
                        <item.icon className="h-4 w-4" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="p-3">
        <div className="flex items-center gap-3 p-2 rounded-md">
          <Avatar className="h-8 w-8">
            <AvatarImage src={user?.profileImageUrl || undefined} />
            <AvatarFallback className="text-xs">{getInitials()}</AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate" data-testid="text-user-name">
              {user?.firstName} {user?.lastName}
            </p>
            <p className="text-xs text-muted-foreground truncate" data-testid="text-user-email">{user?.email}</p>
          </div>
          <a href="/api/logout">
            <SidebarMenuButton className="h-8 w-8 p-0 flex items-center justify-center" data-testid="button-logout">
              <LogOut className="h-4 w-4" />
            </SidebarMenuButton>
          </a>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
