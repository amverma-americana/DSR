import { useCallback, useEffect, useState } from 'react';
import {
  Alert, Box, Button, Card, CardContent, Chip, LinearProgress, Snackbar, Stack, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, TextField, Typography,
} from '@mui/material';
import { mastersApi } from '../../api/client';

/**
 * Runtime settings from dsr.AppSettings. These are the operational rules the DSR service reads on
 * every save (daily hour cap, back-date window, whether a description is mandatory) plus the
 * lockout and SSO policy, so changing them here takes effect without a redeploy.
 *
 * The API validates each value against the setting's declared data type and rejects edits to rows
 * flagged non-editable.
 */
export default function SettingsPage() {
  const [settings, setSettings] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await mastersApi.settings();
      setSettings(data);
      setDrafts(Object.fromEntries(data.map((s) => [s.settingKey, s.settingValue])));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async (key) => {
    try {
      await mastersApi.updateSetting(key, drafts[key]);
      setToast(`Setting ${key} updated.`);
      await load();
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <Box>
      <Typography variant="h5" gutterBottom>System settings</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Operational rules read at runtime. Changes apply within five minutes (server-side cache) or
        immediately on the next application restart.
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      {loading && <LinearProgress sx={{ mb: 1 }} />}

      <Card>
        <CardContent sx={{ p: 0 }}>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Key</TableCell><TableCell>Type</TableCell><TableCell>Value</TableCell>
                  <TableCell>Description</TableCell><TableCell align="right" />
                </TableRow>
              </TableHead>
              <TableBody>
                {settings.map((s) => (
                  <TableRow key={s.settingKey} hover>
                    <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{s.settingKey}</TableCell>
                    <TableCell><Chip size="small" variant="outlined" label={s.dataType} /></TableCell>
                    <TableCell sx={{ width: 180 }}>
                      <TextField size="small" fullWidth disabled={!s.isEditable}
                        value={drafts[s.settingKey] ?? ''}
                        onChange={(e) => setDrafts((d) => ({ ...d, [s.settingKey]: e.target.value }))} />
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption" color="text.secondary">{s.description}</Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Button size="small" disabled={!s.isEditable || drafts[s.settingKey] === s.settingValue}
                        onClick={() => save(s.settingKey)}>Save</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>

      <Snackbar open={Boolean(toast)} autoHideDuration={4000} onClose={() => setToast(null)} message={toast} />
    </Box>
  );
}
