import {
  Alert,
  Box,
  Card,
  CardContent,
  Stack,
  Typography
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { fetchClickEvents, fetchHealth, fetchJobs } from '../lib/api';

interface JobsResponse {
  jobs?: Array<unknown>;
}

interface ClickEventsResponse {
  click_events?: Array<unknown>;
}

export function OverviewPage() {
  const healthQuery = useQuery({ queryKey: ['health'], queryFn: fetchHealth, refetchInterval: 5000 });
  const jobsQuery = useQuery({ queryKey: ['jobs', 'overview'], queryFn: () => fetchJobs(20) });
  const clicksQuery = useQuery({ queryKey: ['clicks', 'overview'], queryFn: () => fetchClickEvents(20) });

  const jobCount = (jobsQuery.data as JobsResponse | undefined)?.jobs?.length || 0;
  const clickCount = (clicksQuery.data as ClickEventsResponse | undefined)?.click_events?.length || 0;

  return (
    <Stack spacing={2}>
      <Typography variant="h5">总览</Typography>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' },
          gap: 2
        }}
      >
        <Card>
          <CardContent>
            <Typography color="text.secondary">API 状态</Typography>
            <Typography variant="h5">{healthQuery.data?.status === 'ok' ? '在线' : '异常'}</Typography>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <Typography color="text.secondary">最近任务（20）</Typography>
            <Typography variant="h5">{jobCount}</Typography>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <Typography color="text.secondary">最近点击（20）</Typography>
            <Typography variant="h5">{clickCount}</Typography>
          </CardContent>
        </Card>
      </Box>

      {healthQuery.error ? (
        <Alert severity="error">API 连接失败：{String(healthQuery.error)}</Alert>
      ) : null}

      <Alert severity="info">
        建议先在“追踪链接”页面生成广告链接，再到“事件与队列”上报事件观察是否入队。
      </Alert>
    </Stack>
  );
}
