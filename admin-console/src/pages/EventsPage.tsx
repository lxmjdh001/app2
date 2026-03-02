import SendIcon from '@mui/icons-material/Send';
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
import { fetchJobs, sendSdkEvent } from '../lib/api';

interface JobRow {
  id: string;
  platform: string;
  platform_event_name: string;
  platform_pixel_id?: number | null;
  pixel_name?: string | null;
  pixel_key?: string | null;
  attribution_campaign?: string | null;
  attribution_source_platform?: string | null;
  attribution_click_id?: string | null;
  attribution_ttclid?: string | null;
  attribution_fbc?: string | null;
  status: string;
  attempt_count: number;
  last_error: string | null;
  updated_at: string;
}

interface JobsResponse {
  jobs?: JobRow[];
}

function statusColor(status: string): 'default' | 'success' | 'warning' | 'error' {
  if (status === 'done') return 'success';
  if (status === 'retry' || status === 'processing' || status === 'pending') return 'warning';
  if (status === 'failed') return 'error';
  return 'default';
}

const defaultEventUid = `evt-${Date.now()}`;

function getAttributionKey(job: JobRow): string {
  return job.attribution_click_id || job.attribution_ttclid || job.attribution_fbc || '-';
}

export function EventsPage() {
  const [eventName, setEventName] = useState('ftd');
  const [eventUid, setEventUid] = useState(defaultEventUid);
  const [oaUid, setOaUid] = useState('oa-demo-1');
  const [ifa, setIfa] = useState('gaid-demo-1');
  const [ttclid, setTtclid] = useState('');
  const [fbc, setFbc] = useState('');
  const [value, setValue] = useState('50');

  const jobsQuery = useQuery({ queryKey: ['jobs', 'events'], queryFn: () => fetchJobs(30), refetchInterval: 5000 });

  const mutation = useMutation({
    mutationFn: async () => {
      return sendSdkEvent({
        event_name: eventName,
        event_uid: eventUid,
        oa_uid: oaUid,
        ifa,
        destinations: ['facebook', 'tiktok'],
        user_data: {
          ttclid,
          fbc
        },
        custom_data: {
          value: Number(value),
          currency: 'USD'
        }
      });
    },
    onSuccess: () => {
      void jobsQuery.refetch();
      setEventUid(`evt-${Date.now()}`);
    }
  });

  const jobs = (jobsQuery.data as JobsResponse | undefined)?.jobs || [];

  return (
    <Stack spacing={2}>
      <Typography variant="h5">事件上报与回传队列</Typography>

      <Card>
        <CardContent>
          <Stack spacing={2}>
            <Typography variant="h6">发送测试事件（SDK 协议）</Typography>
            <TextField label="event_name" value={eventName} onChange={(e) => setEventName(e.target.value)} />
            <TextField label="event_uid" value={eventUid} onChange={(e) => setEventUid(e.target.value)} />
            <TextField label="oa_uid" value={oaUid} onChange={(e) => setOaUid(e.target.value)} />
            <TextField label="ifa" value={ifa} onChange={(e) => setIfa(e.target.value)} />
            <TextField label="ttclid" value={ttclid} onChange={(e) => setTtclid(e.target.value)} />
            <TextField label="fbc" value={fbc} onChange={(e) => setFbc(e.target.value)} />
            <TextField label="value" value={value} onChange={(e) => setValue(e.target.value)} />
            <Button variant="contained" startIcon={<SendIcon />} onClick={() => mutation.mutate()} disabled={mutation.isPending}>
              发送事件
            </Button>
            {mutation.isSuccess ? <Alert severity="success">发送成功，已进入队列。</Alert> : null}
            {mutation.isError ? <Alert severity="error">发送失败：{String(mutation.error)}</Alert> : null}
          </Stack>
        </CardContent>
      </Card>

      <Alert severity="info">
        建议用追踪链接里的 `campaign` 区分广告投手（例如 buyer_a、buyer_b）；队列表会显示对应归因来源。
      </Alert>

      <Card>
        <CardContent>
          <Stack spacing={1}>
            <Typography variant="h6">最近队列任务</Typography>
            <Box sx={{ width: '100%', overflowX: 'auto' }}>
              <Table size="small" sx={{ minWidth: 1280 }}>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>ID</TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>Platform</TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>Pixel</TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>Event</TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>Campaign</TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>Source</TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>归因键</TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>Status</TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>Attempts</TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>Error</TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>Updated</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {jobs.map((job) => (
                    <TableRow key={job.id}>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>{job.id}</TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>{job.platform}</TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>{job.pixel_name || job.pixel_key || '-'}</TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>{job.platform_event_name}</TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>{job.attribution_campaign || '-'}</TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>{job.attribution_source_platform || '-'}</TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>{getAttributionKey(job)}</TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}><Chip label={job.status} color={statusColor(job.status)} size="small" /></TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>{job.attempt_count}</TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>{job.last_error || '-'}</TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>{job.updated_at}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          </Stack>
        </CardContent>
      </Card>
    </Stack>
  );
}
