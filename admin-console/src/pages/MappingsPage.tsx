import SaveIcon from '@mui/icons-material/Save';
import {
  Alert,
  Button,
  Card,
  CardContent,
  MenuItem,
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
import { useState } from 'react';
import { fetchMappings, saveMapping, type Platform } from '../lib/api';

interface MappingRow {
  platform: Platform;
  internal_event_name: string;
  platform_event_name: string;
  is_active: boolean;
}

interface MappingResponse {
  mappings?: MappingRow[];
}

export function MappingsPage() {
  const queryClient = useQueryClient();

  const [platform, setPlatform] = useState<Platform>('facebook');
  const [internalEvent, setInternalEvent] = useState('ftd');
  const [platformEvent, setPlatformEvent] = useState('Purchase');

  const mappingQuery = useQuery({ queryKey: ['mappings'], queryFn: fetchMappings });

  const mutation = useMutation({
    mutationFn: async () => saveMapping(platform, internalEvent, platformEvent),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['mappings'] });
    }
  });

  const mappings = (mappingQuery.data as MappingResponse | undefined)?.mappings || [];

  return (
    <Stack spacing={2}>
      <Typography variant="h5">事件映射管理</Typography>

      <Card>
        <CardContent>
          <Stack spacing={2}>
            <TextField select label="platform" value={platform} onChange={(e) => setPlatform(e.target.value as Platform)}>
              <MenuItem value="facebook">facebook</MenuItem>
              <MenuItem value="tiktok">tiktok</MenuItem>
            </TextField>
            <TextField label="internal_event_name" value={internalEvent} onChange={(e) => setInternalEvent(e.target.value)} />
            <TextField label="platform_event_name" value={platformEvent} onChange={(e) => setPlatformEvent(e.target.value)} />
            <Button variant="contained" startIcon={<SaveIcon />} onClick={() => mutation.mutate()}>
              保存映射
            </Button>
            {mutation.isSuccess ? <Alert severity="success">保存成功</Alert> : null}
            {mutation.isError ? <Alert severity="error">保存失败：{String(mutation.error)}</Alert> : null}
          </Stack>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="h6" sx={{ mb: 1 }}>当前映射</Typography>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Platform</TableCell>
                <TableCell>Internal Event</TableCell>
                <TableCell>Platform Event</TableCell>
                <TableCell>Active</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {mappings.map((row) => (
                <TableRow key={`${row.platform}-${row.internal_event_name}`}>
                  <TableCell>{row.platform}</TableCell>
                  <TableCell>{row.internal_event_name}</TableCell>
                  <TableCell>{row.platform_event_name}</TableCell>
                  <TableCell>{row.is_active ? 'yes' : 'no'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </Stack>
  );
}
