import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  FormControlLabel,
  MenuItem,
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
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { buildTrackingUrl, fetchAuthApps, type AuthAppRow } from '../lib/api';
import { useAuth } from '../context/useAuth';

interface AppsResponse {
  apps?: AuthAppRow[];
}

const createOptionValue = '__create_new_app__';

export function TrackingPage() {
  const navigate = useNavigate();
  const { selectedAppId } = useAuth();
  const [selectedAppKeyOverride, setSelectedAppKeyOverride] = useState('');
  const [redirect, setRedirect] = useState('https://example.com/landing');
  const [platform, setPlatform] = useState('tiktok');
  const [campaign, setCampaign] = useState('buyer_a');
  const [ttclid, setTtclid] = useState('');
  const [fbc, setFbc] = useState('');
  const [appendClickId, setAppendClickId] = useState(true);
  const [copied, setCopied] = useState(false);
  const [copiedAppKey, setCopiedAppKey] = useState('');

  const appsQuery = useQuery({ queryKey: ['auth-apps', 'tracking'], queryFn: fetchAuthApps });

  const apps = useMemo(() => {
    return ((appsQuery.data as AppsResponse | undefined)?.apps || []);
  }, [appsQuery.data]);

  const defaultSelectedApp = useMemo(() => {
    const byCurrent = apps.find((item) => item.id === selectedAppId);
    return byCurrent || apps[0] || null;
  }, [apps, selectedAppId]);

  const effectiveAppKey = selectedAppKeyOverride || defaultSelectedApp?.api_key || '';

  const trackingUrl = useMemo(
    () =>
      buildTrackingUrl({
        appKey: effectiveAppKey,
        redirect,
        platform,
        campaign,
        ttclid,
        fbc,
        appendClickId
      }),
    [effectiveAppKey, redirect, platform, campaign, ttclid, fbc, appendClickId]
  );

  const onCopy = async () => {
    await navigator.clipboard.writeText(trackingUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const onCopyAppKey = async (key: string) => {
    await navigator.clipboard.writeText(key);
    setCopiedAppKey(key);
    setTimeout(() => setCopiedAppKey(''), 1500);
  };

  const canUse = Boolean(effectiveAppKey && campaign);

  return (
    <Stack spacing={2}>
      <Typography variant="h5">追踪链接生成器</Typography>
      <Alert severity="info">
        `app_key` 可以理解为“这个 App 的身份证号”。请从下拉框选择，不建议手动填写。
      </Alert>
      <Alert severity="info">
        用 `campaign` 区分投手来源（示例：`buyer_a`、`buyer_b`、`buyer_c`）。同一 App 多投手时必须填。
      </Alert>

      {apps.length === 0 ? (
        <Alert
          severity="warning"
          action={
            <Button color="inherit" size="small" component={RouterLink} to="/apps">
              去新建 App
            </Button>
          }
        >
          当前没有可用 App，请先创建 App 再生成追踪链接。
        </Alert>
      ) : null}

      <Card>
        <CardContent>
          <Stack spacing={2}>
            <TextField
              select
              label="app_key（下拉选择）"
              value={apps.length === 0 ? '' : effectiveAppKey}
              onChange={(e) => {
                const value = e.target.value;
                if (value === createOptionValue) {
                  navigate('/apps');
                  return;
                }
                setSelectedAppKeyOverride(value);
              }}
              SelectProps={{
                displayEmpty: true,
                renderValue: (selected) => {
                  if (!selected) {
                    return <span style={{ color: '#9e9e9e' }}>暂无可用 App，点击新建</span>;
                  }
                  const found = apps.find((item) => item.api_key === selected);
                  return found ? `${found.name}（app_id: ${found.id}）` : String(selected);
                }
              }}
              helperText="无可选项时，下拉中会显示“点击新建”。"
              fullWidth
            >
              {apps.length === 0 ? (
                <MenuItem value={createOptionValue} sx={{ color: 'text.secondary' }}>
                  暂无可用 App，点击新建
                </MenuItem>
              ) : (
                apps.map((app) => (
                  <MenuItem key={app.id} value={app.api_key}>
                    {app.name}（app_id: {app.id}）
                  </MenuItem>
                ))
              )}
            </TextField>
            <TextField label="跳转链接 redirect" value={redirect} onChange={(e) => setRedirect(e.target.value)} fullWidth />
            <TextField label="平台 platform" value={platform} onChange={(e) => setPlatform(e.target.value)} fullWidth />
            <TextField label="活动 campaign（投手标识）" value={campaign} onChange={(e) => setCampaign(e.target.value)} fullWidth required />
            <TextField label="ttclid（可选）" value={ttclid} onChange={(e) => setTtclid(e.target.value)} fullWidth />
            <TextField label="fbc（可选）" value={fbc} onChange={(e) => setFbc(e.target.value)} fullWidth />
            <FormControlLabel
              control={<Switch checked={appendClickId} onChange={(e) => setAppendClickId(e.target.checked)} />}
              label="自动追加 click_id 参数"
            />
          </Stack>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Stack spacing={2}>
            <Typography variant="subtitle1">生成结果</Typography>
            <Box sx={{ p: 1.5, bgcolor: 'grey.100', borderRadius: 1, wordBreak: 'break-all' }}>{trackingUrl}</Box>
            <Stack direction="row" spacing={1}>
              <Button variant="contained" startIcon={<ContentCopyIcon />} onClick={onCopy} disabled={!canUse}>
                复制
              </Button>
              <Button variant="outlined" startIcon={<OpenInNewIcon />} component="a" href={trackingUrl} target="_blank" disabled={!canUse}>
                打开测试
              </Button>
            </Stack>
            {copied ? <Alert severity="success">已复制到剪贴板</Alert> : null}
          </Stack>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="h6" sx={{ mb: 1 }}>AppKey 列表（可左右滑动）</Typography>
          <Box sx={{ width: '100%', overflowX: 'auto' }}>
            <Table size="small" sx={{ minWidth: 980 }}>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>App ID</TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>App 名称</TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>app_key</TableCell>
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
                      <Button size="small" variant="outlined" startIcon={<ContentCopyIcon />} onClick={() => onCopyAppKey(app.api_key)}>
                        复制 app_key
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
          {copiedAppKey ? <Alert sx={{ mt: 1 }} severity="success">已复制：{copiedAppKey}</Alert> : null}
        </CardContent>
      </Card>
    </Stack>
  );
}
