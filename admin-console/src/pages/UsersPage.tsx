import AddIcon from '@mui/icons-material/Add';
import {
  Alert,
  Button,
  Card,
  CardContent,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import {
  createUser,
  fetchUsers,
  updateUserRole,
  updateUserStatus,
  type UserRole
} from '../lib/api';
import { useAuth } from '../context/useAuth';

interface UserRow {
  id: number;
  username: string;
  display_name: string | null;
  is_active: boolean;
  is_super_admin: boolean;
  role: UserRole;
}

interface UsersResponse {
  users?: UserRow[];
}

const roleOptions: UserRole[] = ['admin', 'operator', 'analyst', 'viewer'];

export function UsersPage() {
  const queryClient = useQueryClient();
  const { appRoles, selectedAppId, isSuperAdmin } = useAuth();

  const selectedRole = appRoles.find((item) => item.app_id === selectedAppId)?.role || 'viewer';
  const canManage = isSuperAdmin || selectedRole === 'admin';

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<UserRole>('viewer');

  const usersQuery = useQuery({ queryKey: ['users', selectedAppId], queryFn: fetchUsers, enabled: Boolean(selectedAppId) });

  const createMutation = useMutation({
    mutationFn: async () =>
      createUser({
        username,
        password,
        display_name: displayName,
        role
      }),
    onSuccess: async () => {
      setUsername('');
      setPassword('');
      setDisplayName('');
      setRole('viewer');
      await queryClient.invalidateQueries({ queryKey: ['users', selectedAppId] });
    }
  });

  const roleMutation = useMutation({
    mutationFn: async (payload: { userId: number; role: UserRole }) => updateUserRole(payload.userId, payload.role),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['users', selectedAppId] });
    }
  });

  const statusMutation = useMutation({
    mutationFn: async (payload: { userId: number; isActive: boolean }) => updateUserStatus(payload.userId, payload.isActive),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['users', selectedAppId] });
    }
  });

  const rows = (usersQuery.data as UsersResponse | undefined)?.users || [];

  const error = useMemo(() => {
    const e = createMutation.error || roleMutation.error || statusMutation.error || usersQuery.error;
    return e ? String(e) : '';
  }, [createMutation.error, roleMutation.error, statusMutation.error, usersQuery.error]);

  return (
    <Stack spacing={2}>
      <Typography variant="h5">用户管理（JWT + RBAC）</Typography>
      <Alert severity={canManage ? 'info' : 'warning'}>
        当前角色：{selectedRole}。{canManage ? '你可以创建用户、分配角色、禁用账号。' : '仅 admin 可管理用户。'}
      </Alert>

      {error ? <Alert severity="error">{error}</Alert> : null}
      {createMutation.isSuccess ? <Alert severity="success">用户创建/更新成功</Alert> : null}

      <Card>
        <CardContent>
          <Stack spacing={2}>
            <Typography variant="h6">创建用户并分配角色</Typography>
            <TextField label="username" value={username} onChange={(e) => setUsername(e.target.value)} disabled={!canManage} />
            <TextField label="password (min 6)" type="password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={!canManage} />
            <TextField label="display_name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} disabled={!canManage} />
            <FormControl>
              <InputLabel>role</InputLabel>
              <Select value={role} label="role" onChange={(e) => setRole(e.target.value as UserRole)} disabled={!canManage}>
                {roleOptions.map((item) => (
                  <MenuItem key={item} value={item}>{item}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => createMutation.mutate()}
              disabled={!canManage || createMutation.isPending || !username || password.length < 6}
            >
              创建/更新用户
            </Button>
          </Stack>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="h6" sx={{ mb: 1 }}>当前应用用户列表</Typography>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>ID</TableCell>
                <TableCell>Username</TableCell>
                <TableCell>Display Name</TableCell>
                <TableCell>Role</TableCell>
                <TableCell>Active</TableCell>
                <TableCell>Super Admin</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>{row.id}</TableCell>
                  <TableCell>{row.username}</TableCell>
                  <TableCell>{row.display_name || '-'}</TableCell>
                  <TableCell>
                    <Select
                      size="small"
                      value={row.role}
                      disabled={!canManage || roleMutation.isPending}
                      onChange={(e) => roleMutation.mutate({ userId: row.id, role: e.target.value as UserRole })}
                    >
                      {roleOptions.map((item) => (
                        <MenuItem key={item} value={item}>{item}</MenuItem>
                      ))}
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={row.is_active}
                      disabled={!canManage || statusMutation.isPending || row.is_super_admin}
                      onChange={(e) => statusMutation.mutate({ userId: row.id, isActive: e.target.checked })}
                    />
                  </TableCell>
                  <TableCell>{row.is_super_admin ? 'yes' : 'no'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </Stack>
  );
}
