import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControlLabel,
  IconButton,
  MenuItem,
  Stack,
  Switch,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import {
  createPlatformPixel,
  deletePlatformPixel,
  fetchAuthApps,
  fetchPlatformPixels,
  updatePlatformPixel,
  type AuthAppRow,
  type Platform
} from '../lib/api';

interface PixelRow {
  id: number;
  app_id: number;
  platform: Platform;
  display_name: string;
  pixel_key: string;
  enabled: boolean;
  endpoint_url: string | null;
  config_json: Record<string, unknown>;
  priority: number;
  has_access_token: boolean;
  updated_at: string;
}

interface PixelListRow extends PixelRow {
  app_name: string;
}

interface PixelsResponse {
  platform_pixels?: PixelRow[];
}

interface AppsResponse {
  apps?: AuthAppRow[];
}

interface PixelCreateForm {
  display_name: string;
  pixel_key: string;
  enabled: boolean;
  endpoint_url: string;
  access_token: string;
  priority: string;
  test_event_code: string;
  config_json_extra: string;
}

interface PlatformViewMeta {
  platform: Platform;
  title: string;
  pixelKeyLabel: string;
}

const platformViewMetas: PlatformViewMeta[] = [
  {
    platform: 'facebook',
    title: 'Facebook',
    pixelKeyLabel: 'pixel_id（必填）'
  },
  {
    platform: 'tiktok',
    title: 'TikTok',
    pixelKeyLabel: 'pixel_code（必填）'
  }
];

function buildPixelCreateForm(): PixelCreateForm {
  return {
    display_name: '',
    pixel_key: '',
    enabled: true,
    endpoint_url: '',
    access_token: '',
    priority: '100',
    test_event_code: '',
    config_json_extra: '{}'
  };
}

function parseExtraConfig(raw: string): Record<string, unknown> {
  const text = raw.trim();
  if (!text) {
    return {};
  }

  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('高级 config_json 必须是对象 JSON');
  }

  return parsed as Record<string, unknown>;
}

export function PlatformsPage() {
  const queryClient = useQueryClient();
  const [error, setError] = useState('');
  const [activePlatform, setActivePlatform] = useState<Platform>('facebook');
  const [appScope, setAppScope] = useState<string>('all');
  const [deleteTarget, setDeleteTarget] = useState<PixelListRow | null>(null);
  const [pixelDrafts, setPixelDrafts] = useState<Record<Platform, PixelCreateForm>>({
    facebook: buildPixelCreateForm(),
    tiktok: buildPixelCreateForm()
  });

  const appsQuery = useQuery({ queryKey: ['auth-apps', 'platforms-page'], queryFn: fetchAuthApps });

  const apps = useMemo(() => {
    const payload = appsQuery.data as AppsResponse | undefined;
    return payload?.apps ?? [];
  }, [appsQuery.data]);

  const appNameById = useMemo(() => {
    const map = new Map<number, string>();
    for (const app of apps) {
      map.set(app.id, app.name);
    }
    return map;
  }, [apps]);

  const scopedAppId = appScope === 'all' ? null : Number.parseInt(appScope, 10);
  const scopedAppName = scopedAppId ? (appNameById.get(scopedAppId) || `App ${scopedAppId}`) : '全部 App';

  const pixelsQuery = useQuery({
    queryKey: ['platform-pixels', 'platforms-page', appScope, apps.map((item) => item.id).join(',')],
    enabled: apps.length > 0,
    queryFn: async () => {
      const targetAppIds = scopedAppId ? [scopedAppId] : apps.map((item) => item.id);
      const merged: PixelListRow[] = [];

      for (const appId of targetAppIds) {
        const response = await fetchPlatformPixels({ appId }) as PixelsResponse;
        for (const row of response.platform_pixels || []) {
          const resolvedAppId = Number(row.app_id) || appId;
          merged.push({
            ...row,
            app_id: resolvedAppId,
            app_name: appNameById.get(resolvedAppId) || `App ${resolvedAppId}`
          });
        }
      }

      return merged;
    }
  });

  const pixelRows = useMemo(
    () => (pixelsQuery.data as PixelListRow[] | undefined) || [],
    [pixelsQuery.data]
  );

  const currentPlatformMeta = platformViewMetas.find((item) => item.platform === activePlatform) || platformViewMetas[0];
  const currentDraft = pixelDrafts[activePlatform];

  const filteredRows = useMemo(
    () => pixelRows.filter((item) => item.platform === activePlatform),
    [pixelRows, activePlatform]
  );

  const patchDraft = (platform: Platform, patch: Partial<PixelCreateForm>) => {
    setPixelDrafts((prev) => ({
      ...prev,
      [platform]: {
        ...prev[platform],
        ...patch
      }
    }));
  };

  const createPixelMutation = useMutation({
    mutationFn: async (payload: { appId: number; platform: Platform; form: PixelCreateForm }) => {
      const priority = Number.parseInt(payload.form.priority, 10);
      if (!Number.isFinite(priority) || priority < 0) {
        throw new Error('priority 必须是 >= 0 的整数');
      }

      const pixelKey = payload.form.pixel_key.trim();
      if (!pixelKey) {
        throw new Error('pixel_key 必填');
      }

      const extraConfig = parseExtraConfig(payload.form.config_json_extra);
      const configJson: Record<string, unknown> = { ...extraConfig };
      if (payload.form.test_event_code.trim()) {
        configJson.test_event_code = payload.form.test_event_code.trim();
      }

      return createPlatformPixel(
        payload.platform,
        {
          display_name: payload.form.display_name.trim() || pixelKey,
          pixel_key: pixelKey,
          enabled: payload.form.enabled,
          endpoint_url: payload.form.endpoint_url.trim() || null,
          access_token: payload.form.access_token.trim() || null,
          priority,
          config_json: configJson
        },
        { appId: payload.appId }
      );
    },
    onSuccess: async (_data, variables) => {
      await queryClient.invalidateQueries({ queryKey: ['platform-pixels', 'platforms-page'] });
      setPixelDrafts((prev) => ({ ...prev, [variables.platform]: buildPixelCreateForm() }));
    },
    onError: (e) => setError(String(e))
  });

  const updatePixelMutation = useMutation({
    mutationFn: async (payload: { appId: number; pixelId: number; enabled: boolean }) =>
      updatePlatformPixel(payload.pixelId, { enabled: payload.enabled }, { appId: payload.appId }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['platform-pixels', 'platforms-page'] });
    },
    onError: (e) => setError(String(e))
  });

  const deletePixelMutation = useMutation({
    mutationFn: async (payload: { appId: number; pixelId: number }) => deletePlatformPixel(payload.pixelId, { appId: payload.appId }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['platform-pixels', 'platforms-page'] });
    },
    onError: (e) => setError(String(e))
  });

  const onCreatePixel = async () => {
    if (!scopedAppId) {
      setError('当前是“全部 App”视图，请先选择具体 App 再新增像素。');
      return;
    }

    setError('');
    await createPixelMutation.mutateAsync({
      appId: scopedAppId,
      platform: activePlatform,
      form: currentDraft
    });
  };

  const onConfirmDelete = async () => {
    if (!deleteTarget) {
      return;
    }

    setError('');
    try {
      await deletePixelMutation.mutateAsync({ appId: deleteTarget.app_id, pixelId: deleteTarget.id });
      setDeleteTarget(null);
    } catch {
      // handled by mutation onError
    }
  };

  const success = createPixelMutation.isSuccess || updatePixelMutation.isSuccess || deletePixelMutation.isSuccess;

  return (
    <Stack spacing={2}>
      <Typography variant="h5">平台配置（多像素）</Typography>

      <Alert severity="info">
        支持“一个 App 多个像素”。列表可直接看到每个像素归属的 App。
      </Alert>
      <Alert severity="warning">`access_token` 仅写入不回显；如需更新可重新填写覆盖。</Alert>
      {error ? <Alert severity="error">{error}</Alert> : null}
      {success ? <Alert severity="success">保存成功</Alert> : null}

      <Card>
        <CardContent>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ xs: 'stretch', md: 'center' }}>
            <TextField
              select
              size="small"
              label="查看 App"
              value={appScope}
              onChange={(e) => setAppScope(e.target.value)}
              sx={{ minWidth: 240 }}
            >
              <MenuItem value="all">全部 App</MenuItem>
              {apps.map((app) => (
                <MenuItem key={app.id} value={String(app.id)}>
                  {app.name}（app_id: {app.id}）
                </MenuItem>
              ))}
            </TextField>
            <Typography variant="body2" color="text.secondary">
              当前视图：{scopedAppName}
            </Typography>
          </Stack>
        </CardContent>
      </Card>

      <Card>
        <Tabs
          value={activePlatform}
          onChange={(_event, value: Platform) => setActivePlatform(value)}
          variant="scrollable"
          allowScrollButtonsMobile
        >
          {platformViewMetas.map((item) => (
            <Tab
              key={item.platform}
              value={item.platform}
              label={`${item.title}（${pixelRows.filter((row) => row.platform === item.platform).length}）`}
            />
          ))}
        </Tabs>
      </Card>

      <Card>
        <CardContent>
          <Stack spacing={1.5}>
            <Typography variant="h6">新增像素</Typography>
            {!scopedAppId ? (
              <Alert severity="info">当前为“全部 App”查看模式，请先选择一个具体 App，再新增像素。</Alert>
            ) : null}

            <TextField
              size="small"
              label="display_name（可选）"
              value={currentDraft.display_name}
              onChange={(e) => patchDraft(activePlatform, { display_name: e.target.value })}
              fullWidth
              disabled={!scopedAppId}
            />
            <TextField
              size="small"
              label={currentPlatformMeta.pixelKeyLabel}
              value={currentDraft.pixel_key}
              onChange={(e) => patchDraft(activePlatform, { pixel_key: e.target.value })}
              fullWidth
              disabled={!scopedAppId}
            />
            <FormControlLabel
              control={
                <Switch
                  checked={currentDraft.enabled}
                  onChange={(e) => patchDraft(activePlatform, { enabled: e.target.checked })}
                  disabled={!scopedAppId}
                />
              }
              label="启用像素"
            />
            <TextField
              size="small"
              label="priority（默认100，越小越靠前）"
              value={currentDraft.priority}
              onChange={(e) => patchDraft(activePlatform, { priority: e.target.value })}
              fullWidth
              disabled={!scopedAppId}
            />
            <TextField
              size="small"
              label="test_event_code（可选）"
              value={currentDraft.test_event_code}
              onChange={(e) => patchDraft(activePlatform, { test_event_code: e.target.value })}
              fullWidth
              disabled={!scopedAppId}
            />
            <TextField
              size="small"
              label="endpoint_url（可选）"
              value={currentDraft.endpoint_url}
              onChange={(e) => patchDraft(activePlatform, { endpoint_url: e.target.value })}
              fullWidth
              disabled={!scopedAppId}
            />
            <TextField
              size="small"
              label="access_token（仅写入）"
              value={currentDraft.access_token}
              onChange={(e) => patchDraft(activePlatform, { access_token: e.target.value })}
              fullWidth
              disabled={!scopedAppId}
            />
            <TextField
              size="small"
              label="高级 config_json（可选）"
              value={currentDraft.config_json_extra}
              onChange={(e) => patchDraft(activePlatform, { config_json_extra: e.target.value })}
              multiline
              minRows={3}
              fullWidth
              disabled={!scopedAppId}
            />
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => {
                void onCreatePixel();
              }}
              disabled={createPixelMutation.isPending || !scopedAppId}
            >
              新增像素
            </Button>
          </Stack>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Stack spacing={1}>
            <Typography variant="h6">像素列表（按当前平台）</Typography>
            <Box sx={{ width: '100%', overflowX: 'auto' }}>
              <Table size="small" sx={{ minWidth: 920 }}>
                <TableHead>
                  <TableRow>
                    <TableCell>ID</TableCell>
                    <TableCell>所属 App</TableCell>
                    <TableCell>名称</TableCell>
                    <TableCell>Pixel Key</TableCell>
                    <TableCell>优先级</TableCell>
                    <TableCell>Token</TableCell>
                    <TableCell>启用</TableCell>
                    <TableCell>操作</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {filteredRows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} align="center">
                        暂无像素数据
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredRows.map((row) => (
                      <TableRow key={`${row.app_id}-${row.id}`}>
                        <TableCell>{row.id}</TableCell>
                        <TableCell>{row.app_name}（{row.app_id}）</TableCell>
                        <TableCell>{row.display_name}</TableCell>
                        <TableCell>{row.pixel_key}</TableCell>
                        <TableCell>{row.priority}</TableCell>
                        <TableCell>{row.has_access_token ? 'yes' : 'no'}</TableCell>
                        <TableCell>
                          <Switch
                            checked={row.enabled}
                            onChange={(e) =>
                              updatePixelMutation.mutate({
                                appId: row.app_id,
                                pixelId: row.id,
                                enabled: e.target.checked
                              })
                            }
                            disabled={updatePixelMutation.isPending}
                          />
                        </TableCell>
                        <TableCell>
                          <IconButton
                            color="error"
                            onClick={() => setDeleteTarget(row)}
                            disabled={deletePixelMutation.isPending}
                          >
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </Box>
          </Stack>
        </CardContent>
      </Card>

      <Dialog
        open={Boolean(deleteTarget)}
        onClose={() => {
          if (!deletePixelMutation.isPending) {
            setDeleteTarget(null);
          }
        }}
      >
        <DialogTitle>确认删除像素？</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {deleteTarget
              ? `即将删除像素「${deleteTarget.display_name} / ${deleteTarget.pixel_key}」，所属 App：${deleteTarget.app_name}。`
              : '确定删除该像素吗？'}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)} disabled={deletePixelMutation.isPending}>
            取消
          </Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => {
              void onConfirmDelete();
            }}
            disabled={deletePixelMutation.isPending}
          >
            确认删除
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
