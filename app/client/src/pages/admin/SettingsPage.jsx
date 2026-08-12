import { useCallback, useEffect, useState } from 'react';
import {
  Alert, Box, Button, Card, Chip, LinearProgress, Snackbar, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, TextField, Tooltip, Typography,
} from '@mui/material';
import { Check, Lock } from 'lucide-react';
import { mastersApi } from '../../api/client';
import PageHeader from '../../components/PageHeader';
import { COLORS } from '../../theme/tokens';

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
      <PageHeader
        title="System settings"
        description="Operational rules read at runtime. Changes apply within five minutes (server-side cache) or immediately on the next application restart."
      />

      {error && <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>{error}</Alert>}

      <Card>
        {loading && <LinearProgress aria-label="Loading settings" />}

        <TableContainer>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell>Setting</TableCell>
                <TableCell>Type</TableCell>
                <TableCell sx={{ width: 200 }}>Value</TableCell>
                <TableCell align="right" sx={{ width: 110 }} />
              </TableRow>
            </TableHead>
            <TableBody>
              {settings.map((s) => {
                const dirty = drafts[s.settingKey] !== s.settingValue;

                return (
                  <TableRow key={s.settingKey} hover>
                    {/* Key and description are combined: the description is what an admin actually
                        reads to decide, and giving it its own column left both cramped. */}
                    <TableCell sx={{ maxWidth: 520 }}>
                      <Typography
                        variant="body2"
                        sx={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 0.75 }}
                      >
                        {!s.isEditable && (
                          <Tooltip title="This setting is read-only">
                            <Box component="span" sx={{ display: 'inline-flex', color: 'text.disabled' }}>
                              <Lock size={12} aria-label="Read-only" />
                            </Box>
                          </Tooltip>
                        )}
                        {s.settingKey}
                      </Typography>
                      {s.description && (
                        <Typography variant="caption" color="text.secondary">{s.description}</Typography>
                      )}
                    </TableCell>

                    <TableCell>
                      <Chip size="small" variant="outlined" label={s.dataType} />
                    </TableCell>

                    <TableCell>
                      <TextField
                        fullWidth
                        disabled={!s.isEditable}
                        value={drafts[s.settingKey] ?? ''}
                        onChange={(e) => setDrafts((d) => ({ ...d, [s.settingKey]: e.target.value }))}
                        inputProps={{ 'aria-label': `Value for ${s.settingKey}` }}
                        sx={dirty ? { '& .MuiOutlinedInput-notchedOutline': { borderColor: COLORS.warning } } : undefined}
                      />
                    </TableCell>

                    <TableCell align="right">
                      <Button
                        size="small"
                        variant={dirty ? 'contained' : 'outlined'}
                        startIcon={<Check size={14} />}
                        disabled={!s.isEditable || !dirty}
                        onClick={() => save(s.settingKey)}
                      >
                        Save
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>

      <Snackbar open={Boolean(toast)} autoHideDuration={4000} onClose={() => setToast(null)} message={toast} />
    </Box>
  );
}
