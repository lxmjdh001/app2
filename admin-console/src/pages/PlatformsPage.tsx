import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import SaveIcon from '@mui/icons-material/Save';
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
  createPlatformPixel,
  deletePlatformPixel,
  fetchPlatformConfigs,
  fetchPlatformPixels,
  savePlatformConfig,
  updatePlatformPixel,
  type Platform
} from '../lib/api';

interface ConfigRow {
  platform: Platform;
  enabled: boolean;
  endpoint_url: string | null;
  config_json: Record<string, unknown>;
}

interface PixelRow {
  id: number;
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

interface ConfigResponse {
  platform_configs?: ConfigRow[];
}

interface PixelsResponse {
  platform_pixels?: PixelRow[];
}

interface LegacyFormState {
  enabled: boolean;
  endpoint_url: string;
  access_token: string;
  pixel_id: string;
  pixel_code: string;
  test_event_code: string;
  config_json_extra: string;
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

function pickString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function buildExtraConfig(configJson: Record<string, unknown> | undefined): string {
  const source = configJson || {};
  const entries = Object.entries(source).filter(([key]) => !['pixel_id', 'pixel_code', 'test_event_code'].includes(key));
  const extra = Object.fromEntries(entries);
  return JSON.stringify(extra, null, 2);
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

function buildLegacyForm(row: ConfigRow | undefined, platform: Platform): LegacyFormState {
  const configJson = row?.config_json || {};
  return {
    enabled: row?.enabled ?? false,
    endpoint_url: row?.endpoint_url ?? '',
    access_token: '',
    pixel_id: platform === 'facebook' ? pickString(configJson.pixel_id) : '',
    pixel_code: platform === 'tiktok' ? pickString(configJson.pixel_code) : '',
    test_event_code: pickString(configJson.test_event_code),
    config_json_extra: buildExtraConfig(configJson)
  };
}

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

export function PlatformsPage() {
  const queryClient = useQueryClient();
  const [error, setError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<PixelRow | null>(null);

  const [facebookLegacyDraft, setFacebookLegacyDraft] = useState<Partial<LegacyFormState>>({});
  const [tiktokLegacyDraft, setTikTokLegacyDraft] = useState<Partial<LegacyFormState>>({});

  const [facebookPixelDraft, setFacebookPixelDraft] = useState<PixelCreateForm>(buildPixelCreateForm());
  const [tiktokPixelDraft, setTikTokPixelDraft] = useState<PixelCreateForm>(buildPixelCreateForm());

  const { data: configData } = useQuery({ queryKey: ['platform-configs'], queryFn: fetchPlatformConfigs });
  const { data: pixelData } = useQuery({ queryKey: ['platform-pixels'], queryFn: fetchPlatformPixels });

  const configRows = useMemo(() => {
    const payload = configData as ConfigResponse | undefined;
    return payload?.platform_configs ?? [];
  }, [configData]);

  const pixelRows = useMemo(() => {
    const payload = pixelData as PixelsResponse | undefined;
    return payload?.platform_pixels ?? [];
  }, [pixelData]);

  const facebookLegacy = useMemo(
    () => ({ ...buildLegacyForm(configRows.find((item) => item.platform === 'facebook'), 'facebook'), ...facebookLegacyDraft }),
    [configRows, facebookLegacyDraft]
  );

  const tiktokLegacy = useMemo(
    () => ({ ...buildLegacyForm(configRows.find((item) => item.platform === 'tiktok'), 'tiktok'), ...tiktokLegacyDraft }),
    [configRows, tiktokLegacyDraft]
  );

  const saveLegacyMutation = useMutation({
    mutationFn: async (payload: { platform: Platform; form: LegacyFormState }) => {
      const extraConfig = parseExtraConfig(payload.form.config_json_extra);
      const configJson: Record<string, unknown> = { ...extraConfig };

      if (payload.platform === 'facebook' && payload.form.pixel_id.trim()) {
        configJson.pixel_id = payload.form.pixel_id.trim();
      }

      if (payload.platform === 'tiktok' && payload.form.pixel_code.trim()) {
        configJson.pixel_code = payload.form.pixel_code.trim();
      }

      if (payload.form.test_event_code.trim()) {
        configJson.test_event_code = payload.form.test_event_code.trim();
      }

      return savePlatformConfig(payload.platform, {
        enabled: payload.form.enabled,
        endpoint_url: payload.form.endpoint_url || null,
        access_token: payload.form.access_token || null,
        config_json: configJson
      });
    },
    onSuccess: async (_data, variables) => {
      await queryClient.invalidateQueries({ queryKey: ['platform-configs'] });
      if (variables.platform === 'facebook') {
        setFacebookLegacyDraft({});
      } else {
        setTikTokLegacyDraft({});
      }
    },
    onError: (e) => setError(String(e))
  });

  const createPixelMutation = useMutation({
    mutationFn: async (payload: { platform: Platform; form: PixelCreateForm }) => {
      const priority = Number.parseInt(payload.form.priority, 10);
      if (!Number.isFinite(priority) || priority < 0) {
        throw new Error('priority 必须是 >= 0 的整数');
      }

      if (!payload.form.pixel_key.trim()) {
        throw new Error('pixel_key 必填');
      }

      const extraConfig = parseExtraConfig(payload.form.config_json_extra);
      const configJson: Record<string, unknown> = { ...extraConfig };
      if (payload.form.test_event_code.trim()) {
        configJson.test_event_code = payload.form.test_event_code.trim();
      }

      return createPlatformPixel(payload.platform, {
        display_name: payload.form.display_name.trim() || payload.form.pixel_key.trim(),
        pixel_key: payload.form.pixel_key.trim(),
        enabled: payload.form.enabled,
        endpoint_url: payload.form.endpoint_url.trim() || null,
        access_token: payload.form.access_token.trim() || null,
        priority,
        config_json: configJson
      });
    },
    onSuccess: async (_data, variables) => {
      await queryClient.invalidateQueries({ queryKey: ['platform-pixels'] });
      if (variables.platform === 'facebook') {
        setFacebookPixelDraft(buildPixelCreateForm());
      } else {
        setTikTokPixelDraft(buildPixelCreateForm());
      }
    },
    onError: (e) => setError(String(e))
  });

  const updatePixelMutation = useMutation({
    mutationFn: async (payload: { pixelId: number; enabled: boolean }) => updatePlatformPixel(payload.pixelId, { enabled: payload.enabled }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['platform-pixels'] });
    },
    onError: (e) => setError(String(e))
  });

  const deletePixelMutation = useMutation({
    mutationFn: async (pixelId: number) => deletePlatformPixel(pixelId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['platform-pixels'] });
    },
    onError: (e) => setError(String(e))
  });

  const onSaveLegacy = async (platform: Platform, form: LegacyFormState) => {
    setError('');
    await saveLegacyMutation.mutateAsync({ platform, form });
  };

  const onCreatePixel = async (platform: Platform, form: PixelCreateForm) => {
    setError('');
    await createPixelMutation.mutateAsync({ platform, form });
  };

  const onConfirmDeletePixel = async () => {
    if (!deleteTarget) {
      return;
    }

    setError('');
    try {
      await deletePixelMutation.mutateAsync(deleteTarget.id);
      setDeleteTarget(null);
    } catch {
      // error is already stored by mutation onError
    }
  };

  const renderPixelRows = (platform: Platform) => pixelRows.filter((item) => item.platform === platform);

  const renderPlatformCard = (platform: Platform, title: string) => {
    const legacy = platform === 'facebook' ? facebookLegacy : tiktokLegacy;
    const setLegacyDraft = platform === 'facebook' ? setFacebookLegacyDraft : setTikTokLegacyDraft;

    const pixelDraft = platform === 'facebook' ? facebookPixelDraft : tiktokPixelDraft;
    const setPixelDraft = platform === 'facebook' ? setFacebookPixelDraft : setTikTokPixelDraft;

    return (
      <Card key={platform}>
        <CardContent>
          <Stack spacing={2}>
            <Typography variant="h6">{title}</Typography>
            <Alert severity="info">一个 App 可配置多个像素，事件会按平台向所有已启用像素回传。</Alert>

            <Typography variant="subtitle1">兼容单像素回退配置（可选）</Typography>
            <FormControlLabel
              control={
                <Switch
                  checked={legacy.enabled}
                  onChange={(e) => setLegacyDraft((prev) => ({ ...prev, enabled: e.target.checked }))}
                />
              }
              label="启用回退"
            />
            {platform === 'facebook' ? (
              <TextField
                label="fallback pixel_id（可选）"
                value={legacy.pixel_id}
                onChange={(e) => setLegacyDraft((prev) => ({ ...prev, pixel_id: e.target.value }))}
                fullWidth
              />
            ) : (
              <TextField
                label="fallback pixel_code（可选）"
                value={legacy.pixel_code}
                onChange={(e) => setLegacyDraft((prev) => ({ ...prev, pixel_code: e.target.value }))}
                fullWidth
              />
            )}
            <TextField
              label="test_event_code（可选）"
              value={legacy.test_event_code}
              onChange={(e) => setLegacyDraft((prev) => ({ ...prev, test_event_code: e.target.value }))}
              fullWidth
            />
            <TextField
              label="endpoint_url（可选）"
              value={legacy.endpoint_url}
              onChange={(e) => setLegacyDraft((prev) => ({ ...prev, endpoint_url: e.target.value }))}
              fullWidth
            />
            <TextField
              label="access_token（仅写入）"
              value={legacy.access_token}
              onChange={(e) => setLegacyDraft((prev) => ({ ...prev, access_token: e.target.value }))}
              fullWidth
            />
            <TextField
              label="高级 config_json（可选）"
              value={legacy.config_json_extra}
              onChange={(e) => setLegacyDraft((prev) => ({ ...prev, config_json_extra: e.target.value }))}
              multiline
              minRows={5}
              fullWidth
            />
            <Button variant="outlined" startIcon={<SaveIcon />} onClick={() => onSaveLegacy(platform, legacy)}>
              保存回退配置
            </Button>

            <Typography variant="subtitle1">新增像素</Typography>
            <TextField
              label="display_name（可选）"
              value={pixelDraft.display_name}
              onChange={(e) => setPixelDraft((prev) => ({ ...prev, display_name: e.target.value }))}
              fullWidth
            />
            <TextField
              label={platform === 'facebook' ? 'pixel_id（必填）' : 'pixel_code（必填）'}
              value={pixelDraft.pixel_key}
              onChange={(e) => setPixelDraft((prev) => ({ ...prev, pixel_key: e.target.value }))}
              fullWidth
            />
            <FormControlLabel
              control={
                <Switch
                  checked={pixelDraft.enabled}
                  onChange={(e) => setPixelDraft((prev) => ({ ...prev, enabled: e.target.checked }))}
                />
              }
              label="启用像素"
            />
            <TextField
              label="priority（默认100，越小越靠前）"
              value={pixelDraft.priority}
              onChange={(e) => setPixelDraft((prev) => ({ ...prev, priority: e.target.value }))}
              fullWidth
            />
            <TextField
              label="test_event_code（可选）"
              value={pixelDraft.test_event_code}
              onChange={(e) => setPixelDraft((prev) => ({ ...prev, test_event_code: e.target.value }))}
              fullWidth
            />
            <TextField
              label="endpoint_url（可选）"
              value={pixelDraft.endpoint_url}
              onChange={(e) => setPixelDraft((prev) => ({ ...prev, endpoint_url: e.target.value }))}
              fullWidth
            />
            <TextField
              label="access_token（仅写入）"
              value={pixelDraft.access_token}
              onChange={(e) => setPixelDraft((prev) => ({ ...prev, access_token: e.target.value }))}
              fullWidth
            />
            <TextField
              label="高级 config_json（可选）"
              value={pixelDraft.config_json_extra}
              onChange={(e) => setPixelDraft((prev) => ({ ...prev, config_json_extra: e.target.value }))}
              multiline
              minRows={4}
              fullWidth
            />
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => onCreatePixel(platform, pixelDraft)}
              disabled={createPixelMutation.isPending}
            >
              新增像素
            </Button>

            <Typography variant="subtitle1">像素列表</Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>ID</TableCell>
                  <TableCell>名称</TableCell>
                  <TableCell>Pixel Key</TableCell>
                  <TableCell>优先级</TableCell>
                  <TableCell>Token</TableCell>
                  <TableCell>启用</TableCell>
                  <TableCell>操作</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {renderPixelRows(platform).map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>{row.id}</TableCell>
                    <TableCell>{row.display_name}</TableCell>
                    <TableCell>{row.pixel_key}</TableCell>
                    <TableCell>{row.priority}</TableCell>
                    <TableCell>{row.has_access_token ? 'yes' : 'no'}</TableCell>
                    <TableCell>
                      <Switch
                        checked={row.enabled}
                        onChange={(e) => updatePixelMutation.mutate({ pixelId: row.id, enabled: e.target.checked })}
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
                ))}
              </TableBody>
            </Table>
          </Stack>
        </CardContent>
      </Card>
    );
  };

  const success =
    saveLegacyMutation.isSuccess ||
    createPixelMutation.isSuccess ||
    updatePixelMutation.isSuccess ||
    deletePixelMutation.isSuccess;

  return (
    <Stack spacing={2}>
      <Typography variant="h5">平台配置（多像素）</Typography>
      <Alert severity="info">
        现在每个平台支持多个像素。只要像素启用，事件将创建独立队列任务并分别回传。
      </Alert>
      <Alert severity="warning">`access_token` 仅写入不回显；如需更新可重新填写覆盖。</Alert>
      {error ? <Alert severity="error">{error}</Alert> : null}
      {success ? <Alert severity="success">保存成功</Alert> : null}

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
        {renderPlatformCard('facebook', 'Facebook')}
        {renderPlatformCard('tiktok', 'TikTok')}
      </Box>

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
              ? `即将删除像素「${deleteTarget.display_name} / ${deleteTarget.pixel_key}」。删除后该像素不再接收回传任务。`
              : '确定删除该像素吗？'}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setDeleteTarget(null)}
            disabled={deletePixelMutation.isPending}
          >
            取消
          </Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => {
              void onConfirmDeletePixel();
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
