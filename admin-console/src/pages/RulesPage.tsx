import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
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
  Tooltip,
  Typography
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { activateRule, createRule, fetchRules } from '../lib/api';

interface RuleRow {
  version: number;
  rule_name: string;
  lookback_window_hours: number;
  click_priority: string[];
  allow_event_side_create: boolean;
  is_active: boolean;
  updated_at: string;
}

interface RulesResponse {
  rules?: RuleRow[];
}

function FieldHelp({ label, tip }: { label: string; tip: string }) {
  return (
    <Stack direction="row" spacing={0.5} alignItems="center">
      <Typography variant="body2">{label}</Typography>
      <Tooltip title={tip} arrow>
        <HelpOutlineIcon fontSize="small" color="action" sx={{ cursor: 'help' }} />
      </Tooltip>
    </Stack>
  );
}

export function RulesPage() {
  const queryClient = useQueryClient();

  const [ruleName, setRuleName] = useState('last_touch_24h');
  const [lookback, setLookback] = useState('24');
  const [priority, setPriority] = useState<'click_id,ttclid,fbc' | 'ttclid,fbc,click_id' | 'fbc,ttclid,click_id'>('ttclid,fbc,click_id');
  const [allowCreate, setAllowCreate] = useState(false);

  const rulesQuery = useQuery({ queryKey: ['rules'], queryFn: fetchRules });

  const createMutation = useMutation({
    mutationFn: async () =>
      createRule({
        rule_name: ruleName,
        lookback_window_hours: Number(lookback),
        click_priority: priority.split(',') as Array<'click_id' | 'ttclid' | 'fbc'>,
        allow_event_side_create: allowCreate,
        activate: true
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['rules'] });
    }
  });

  const activateMutation = useMutation({
    mutationFn: async (version: number) => activateRule(version),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['rules'] });
    }
  });

  const rules = (rulesQuery.data as RulesResponse | undefined)?.rules || [];

  return (
    <Stack spacing={2}>
      <Typography variant="h5">归因规则管理（版本化）</Typography>

      <Card>
        <CardContent>
          <Stack spacing={2}>
            <Typography variant="h6">新建规则版本</Typography>

            <FieldHelp label="规则名称（rule_name）" tip="仅用于管理和区分版本，不直接影响归因计算结果。示例：last_touch_24h。" />
            <TextField value={ruleName} onChange={(e) => setRuleName(e.target.value)} placeholder="例如：last_touch_24h" />

            <FieldHelp label="回溯窗口小时（lookback_window_hours）" tip="事件发生时，只在最近 N 小时内的点击里找归因。超过该时间的点击不参与归因。" />
            <TextField value={lookback} onChange={(e) => setLookback(e.target.value)} placeholder="例如：24" />

            <FieldHelp label="点击标识优先级（click_priority）" tip="当同时存在多个归因标识时，按此顺序匹配。顺序越靠前，优先级越高。" />
            <TextField select value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)}>
              <MenuItem value="click_id,ttclid,fbc">click_id → ttclid → fbc</MenuItem>
              <MenuItem value="ttclid,fbc,click_id">ttclid → fbc → click_id</MenuItem>
              <MenuItem value="fbc,ttclid,click_id">fbc → ttclid → click_id</MenuItem>
            </TextField>

            <FormControlLabel
              control={<Switch checked={allowCreate} onChange={(e) => setAllowCreate(e.target.checked)} />}
              label={
                <FieldHelp
                  label="允许事件侧创建归因键"
                  tip="开启后：事件里带 click_id/ttclid/fbc 时，即使没有先记录点击，也会自动补建归因键。关闭后：必须先有点击记录才能归因。"
                />
              }
            />

            <Button variant="contained" onClick={() => createMutation.mutate()} disabled={createMutation.isPending}>
              创建并激活新版本
            </Button>
            {createMutation.isSuccess ? <Alert severity="success">创建成功</Alert> : null}
            {createMutation.isError ? <Alert severity="error">创建失败：{String(createMutation.error)}</Alert> : null}
          </Stack>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="h6" sx={{ mb: 1 }}>规则列表</Typography>
          <Box sx={{ width: '100%', overflowX: 'auto' }}>
            <Table size="small" sx={{ minWidth: 920 }}>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>版本</TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>规则名</TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>回溯窗口</TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>优先级</TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>允许事件补建</TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>状态</TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>操作</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rules.map((rule) => (
                  <TableRow key={rule.version}>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{rule.version}</TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{rule.rule_name}</TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{rule.lookback_window_hours}h</TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{rule.click_priority.join(' > ')}</TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{rule.allow_event_side_create ? '是' : '否'}</TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      {rule.is_active ? <Chip size="small" color="success" label="生效中" /> : <Chip size="small" label="未生效" />}
                    </TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      <Button
                        size="small"
                        variant="outlined"
                        disabled={rule.is_active || activateMutation.isPending}
                        onClick={() => activateMutation.mutate(rule.version)}
                      >
                        激活
                      </Button>
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
