import AppsIcon from '@mui/icons-material/Apps';
import DashboardIcon from '@mui/icons-material/Dashboard';
import DescriptionIcon from '@mui/icons-material/Description';
import GroupIcon from '@mui/icons-material/Group';
import InsightsIcon from '@mui/icons-material/Insights';
import LinkIcon from '@mui/icons-material/Link';
import ListAltIcon from '@mui/icons-material/ListAlt';
import LogoutIcon from '@mui/icons-material/Logout';
import MapIcon from '@mui/icons-material/Map';
import MenuIcon from '@mui/icons-material/Menu';
import RuleIcon from '@mui/icons-material/Rule';
import SettingsIcon from '@mui/icons-material/Settings';
import {
  AppBar,
  Box,
  Chip,
  CssBaseline,
  Divider,
  Drawer,
  FormControl,
  IconButton,
  InputLabel,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Select,
  Toolbar,
  Typography
} from '@mui/material';
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link as RouterLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/useAuth';

const drawerWidth = 260;

interface NavItem {
  label: string;
  path: string;
  icon: ReactNode;
}

export function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const { username, appRoles, selectedAppId, selectApp, logout, isSuperAdmin } = useAuth();

  const selectedRole = appRoles.find((item) => item.app_id === selectedAppId);
  const selectedRoleName = selectedRole?.role || 'viewer';
  const canManageUsers = isSuperAdmin || selectedRoleName === 'admin';

  const navItems = useMemo<NavItem[]>(() => {
    const baseItems: NavItem[] = [
      { label: '总览', path: '/', icon: <DashboardIcon /> },
      { label: 'App管理', path: '/apps', icon: <AppsIcon /> },
      { label: '追踪链接', path: '/tracking', icon: <LinkIcon /> },
      { label: '平台配置', path: '/platforms', icon: <SettingsIcon /> },
      { label: '事件与队列', path: '/events', icon: <ListAltIcon /> },
      { label: '归因规则', path: '/rules', icon: <RuleIcon /> },
      { label: '事件映射', path: '/mappings', icon: <MapIcon /> },
      { label: '分析报表', path: '/analytics', icon: <InsightsIcon /> },
      { label: '配置文档', path: '/docs', icon: <DescriptionIcon /> }
    ];

    if (canManageUsers) {
      baseItems.push({ label: '用户管理', path: '/users', icon: <GroupIcon /> });
    }

    return baseItems;
  }, [canManageUsers]);

  const drawer = (
    <Box>
      <Toolbar>
        <Typography variant="h6" noWrap>
          Postback Admin
        </Typography>
      </Toolbar>
      <Divider />
      <Box sx={{ p: 2 }}>
        <FormControl fullWidth size="small">
          <InputLabel>当前 App</InputLabel>
          <Select
            value={selectedAppId ? String(selectedAppId) : ''}
            label="当前 App"
            onChange={(e) => selectApp(Number(e.target.value))}
          >
            {appRoles.map((role) => (
              <MenuItem key={role.app_id} value={String(role.app_id)}>
                {role.app_name} ({role.role})
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Box>
      <Divider />
      <List>
        {navItems.map((item) => {
          const selected = location.pathname === item.path;
          return (
            <ListItem key={item.path} disablePadding>
              <ListItemButton
                component={RouterLink}
                to={item.path}
                selected={selected}
                onClick={() => setMobileOpen(false)}
              >
                <ListItemIcon>{item.icon}</ListItemIcon>
                <ListItemText primary={item.label} />
              </ListItemButton>
            </ListItem>
          );
        })}
      </List>
      <Divider />
      <List>
        <ListItem>
          <ListItemText primary={username || '-'} secondary={selectedRole?.app_name || '未选择应用'} />
        </ListItem>
        <ListItem>
          <Chip size="small" label={`Role: ${selectedRole?.role || '-'}`} color="primary" />
        </ListItem>
        <ListItem disablePadding>
          <ListItemButton onClick={logout}>
            <ListItemIcon>
              <LogoutIcon />
            </ListItemIcon>
            <ListItemText primary="退出" />
          </ListItemButton>
        </ListItem>
      </List>
    </Box>
  );

  return (
    <Box sx={{ display: 'flex' }}>
      <CssBaseline />
      <AppBar
        position="fixed"
        sx={{
          width: { sm: `calc(100% - ${drawerWidth}px)` },
          ml: { sm: `${drawerWidth}px` }
        }}
      >
        <Toolbar>
          <IconButton
            color="inherit"
            edge="start"
            onClick={() => setMobileOpen(!mobileOpen)}
            sx={{ mr: 2, display: { sm: 'none' } }}
          >
            <MenuIcon />
          </IconButton>
          <Typography variant="h6" noWrap>
            回传管理中后台（JWT + RBAC）
          </Typography>
        </Toolbar>
      </AppBar>
      <Box component="nav" sx={{ width: { sm: drawerWidth }, flexShrink: { sm: 0 } }}>
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={() => setMobileOpen(false)}
          ModalProps={{ keepMounted: true }}
          sx={{
            display: { xs: 'block', sm: 'none' },
            '& .MuiDrawer-paper': { boxSizing: 'border-box', width: drawerWidth }
          }}
        >
          {drawer}
        </Drawer>
        <Drawer
          variant="permanent"
          sx={{
            display: { xs: 'none', sm: 'block' },
            '& .MuiDrawer-paper': { boxSizing: 'border-box', width: drawerWidth }
          }}
          open
        >
          {drawer}
        </Drawer>
      </Box>
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          width: { sm: `calc(100% - ${drawerWidth}px)` },
          p: 3,
          minHeight: '100vh'
        }}
      >
        <Toolbar />
        <Outlet />
      </Box>
    </Box>
  );
}
