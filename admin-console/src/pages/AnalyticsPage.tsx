import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import SaveIcon from '@mui/icons-material/Save';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Stack,
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
import { fetchSqlQueries, runAnalytics, saveSqlQuery } from '../lib/api';

interface SqlQueryRow {
  query_name: string;
  version: number;
  sql_template: string;
  is_active: boolean;
}

interface SqlQueriesResponse {
  clickhouse_enabled?: boolean;
  queries?: SqlQueryRow[];
}

interface AnalyticsRunResponse {
  source: string;
  rows: Array<Record<string, unknown>>;
}

function isoForInput(date: Date): string {
  return date.toISOString().slice(0, 19) + 'Z';
}

const defaultRangeEnd = new Date();
const defaultRangeStart = new Date(defaultRangeEnd.getTime() - 24 * 3600 * 1000);
const defaultFromValue = isoForInput(defaultRangeStart);
const defaultToValue = isoForInput(defaultRangeEnd);

export function AnalyticsPage() {
  const queryClient = useQueryClient();
  const [queryName, setQueryName] = useState('attribution_overview');
  const [sqlTemplate, setSqlTemplate] = useState(
    "SELECT platform, count() AS total_jobs FROM postback_jobs_analytics WHERE app_id = {{app_id}} AND updated_at >= toDateTime({{from}}) AND updated_at < toDateTime({{to}}) GROUP BY platform"
  );
  const [from, setFrom] = useState(defaultFromValue);
  const [to, setTo] = useState(defaultToValue);

  const queriesQuery = useQuery({ queryKey: ['sql-queries'], queryFn: fetchSqlQueries });

  const saveMutation = useMutation({
    mutationFn: async () => saveSqlQuery(queryName, sqlTemplate),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['sql-queries'] });
    }
  });

  const runMutation = useMutation({
    mutationFn: async () => runAnalytics(queryName, from, to)
  });

  const sqlRows = (queriesQuery.data as SqlQueriesResponse | undefined)?.queries || [];
  const clickhouseEnabled = Boolean((queriesQuery.data as SqlQueriesResponse | undefined)?.clickhouse_enabled);

  const resultRows = useMemo(() => {
    const data = runMutation.data as AnalyticsRunResponse | undefined;
    return data?.rows || [];
  }, [runMutation.data]);

  const resultHeaders = resultRows.length > 0 ? Object.keys(resultRows[0]) : [];

  return (
    <Stack spacing={2}>
      <Typography variant="h5">分析报表与 SQL 归因</Typography>
      <Alert severity={clickhouseEnabled ? 'success' : 'warning'}>
        ClickHouse 状态：{clickhouseEnabled ? '已开启（使用 clickhouse）' : '未开启（使用 postgres fallback）'}
      </Alert>

      <Card>
        <CardContent>
          <Stack spacing={2}>
            <Typography variant="h6">维护 SQL 模板</Typography>
            <TextField label="query_name" value={queryName} onChange={(e) => setQueryName(e.target.value)} />
            <TextField
              label="sql_template"
              value={sqlTemplate}
              onChange={(e) => setSqlTemplate(e.target.value)}
              multiline
              minRows={5}
            />
            <Button variant="contained" startIcon={<SaveIcon />} onClick={() => saveMutation.mutate()}>
              保存 SQL 版本
            </Button>
            {saveMutation.isSuccess ? <Alert severity="success">保存成功</Alert> : null}
            {saveMutation.isError ? <Alert severity="error">保存失败：{String(saveMutation.error)}</Alert> : null}
          </Stack>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Stack spacing={2}>
            <Typography variant="h6">执行 SQL 查询</Typography>
            <TextField label="from (ISO)" value={from} onChange={(e) => setFrom(e.target.value)} />
            <TextField label="to (ISO)" value={to} onChange={(e) => setTo(e.target.value)} />
            <Button variant="contained" startIcon={<PlayArrowIcon />} onClick={() => runMutation.mutate()}>
              运行
            </Button>
            {runMutation.isError ? <Alert severity="error">执行失败：{String(runMutation.error)}</Alert> : null}

            {resultHeaders.length > 0 ? (
              <Box sx={{ width: '100%', overflowX: 'auto' }}>
                <Table size="small" sx={{ minWidth: 720 }}>
                  <TableHead>
                    <TableRow>
                      {resultHeaders.map((header) => (
                        <TableCell key={header} sx={{ whiteSpace: 'nowrap' }}>{header}</TableCell>
                      ))}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {resultRows.map((row, index) => (
                      <TableRow key={`row-${index}`}>
                        {resultHeaders.map((header) => (
                          <TableCell key={`${index}-${header}`} sx={{ whiteSpace: 'nowrap' }}>{String(row[header] ?? '')}</TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>
            ) : null}
          </Stack>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="h6" sx={{ mb: 1 }}>当前 SQL 列表</Typography>
          <Box sx={{ width: '100%', overflowX: 'auto' }}>
            <Table size="small" sx={{ minWidth: 980 }}>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>Name</TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>Version</TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>Active</TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>SQL</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {sqlRows.map((row) => (
                  <TableRow key={`${row.query_name}-${row.version}`}>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{row.query_name}</TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{row.version}</TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{row.is_active ? 'yes' : 'no'}</TableCell>
                    <TableCell sx={{ maxWidth: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {row.sql_template}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        </CardContent>
      </Card>
    </Stack>
  );
}
