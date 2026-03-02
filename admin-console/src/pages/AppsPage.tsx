import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography
} from '@mui/material';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { createAuthApp, fetchAuthApps, type AuthAppRow } from '../lib/api';
import { useAuth } from '../context/useAuth';

interface AppsResponse {
  apps?: AuthAppRow[];
}

export function AppsPage() {
  const { refreshProfile, selectApp } = useAuth();
  const [appName, setAppName] = useState('');
  const [copiedKey, setCopiedKey] = useState('');

  const appsQuery = useQuery({ queryKey: ['auth-apps'], queryFn: fetchAuthApps });

  const createMutation = useMutation({
    mutationFn: async () => createAuthApp(appName),
    onSuccess: async (data) => {
      await appsQuery.refetch();
      await refreshProfile();
      selectApp(data.app.id);
      setAppName('');
    }
  });

  const apps = (appsQuery.data as AppsResponse | undefined)?.apps || [];

  const onCopyKey = async (apiKey: string) => {
    await navigator.clipboard.writeText(apiKey);
    setCopiedKey(apiKey);
    setTimeout(() => setCopiedKey(''), 1500);
  };

  return (
    <Stack spacing={2}>
      <Typography variant="h5">App 管理</Typography>

      <Alert severity="info">
        每个 App 都会自动生成唯一 `app_key`。客户投放链接和 SDK 上报时，都要用对应 App 的 `app_key`。
      </Alert>

      <Card>
        <CardContent>
          <Stack spacing={2}>
            <Typography variant="h6">新建 App</Typography>
            <TextField
              label="App 名称"
              value={appName}
              onChange={(e) => setAppName(e.target.value)}
              placeholder="例如：nex855-th-android"
              fullWidth
            />
            <Button
              variant="contained"
              startIcon={<AddCircleOutlineIcon />}
              disabled={!appName.trim() || createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              创建 App（自动生成 app_key）
            </Button>
            {createMutation.isSuccess ? <Alert severity="success">创建成功，已自动切换到新 App。</Alert> : null}
            {createMutation.isError ? <Alert severity="error">创建失败：{String(createMutation.error)}</Alert> : null}
          </Stack>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="h6" sx={{ mb: 1 }}>我的 App 列表（可左右滑动）</Typography>
          <Box sx={{ width: '100%', overflowX: 'auto' }}>
            <Table size="small" sx={{ minWidth: 1100 }}>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>App ID</TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>App 名称</TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>app_key</TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>状态</TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>我的角色</TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>创建时间</TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>操作</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {apps.map((app) => (
                  <TableRow key={app.id}>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{app.id}</TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{app.name}</TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap', fontFamily: 'monospace' }}>{app.api_key}</TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      {app.is_active ? <Chip size="small" color="success" label="启用" /> : <Chip size="small" label="停用" />}
                    </TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{app.role}</TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{app.created_at}</TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={<ContentCopyIcon />}
                        onClick={() => onCopyKey(app.api_key)}
                      >
                        复制 app_key
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
          {copiedKey ? <Alert sx={{ mt: 1 }} severity="success">已复制：{copiedKey}</Alert> : null}
        </CardContent>
      </Card>
    </Stack>
  );
}
