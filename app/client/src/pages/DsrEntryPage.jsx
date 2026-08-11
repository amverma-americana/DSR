import { useCallback, useEffect, useMemo, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import {
  Alert, Box, Button, Card, CardContent, Checkbox, Chip, CircularProgress, Divider,
  FormControl, FormControlLabel, FormHelperText, Grid, IconButton, InputLabel, LinearProgress,
  MenuItem, Radio, RadioGroup, Select, Snackbar, Stack, Table, TableBody, TableCell, TableHead,
  TableRow, TextField, Tooltip, Typography,
} from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import SaveIcon from '@mui/icons-material/Save';
import AddIcon from '@mui/icons-material/Add';
import dayjs from 'dayjs';
import { dsrApi } from '../api/client';
import RichTextField from '../components/RichTextField';

/**
 * DSR ENTRY SCREEN.
 *
 * The screen is built around the flat grain: the form saves ONE entry for ONE project, and the user
 * presses Save again to add the next project on the same date. Saved entries for the chosen date
 * appear in the table below with a running total, so the 4 + 2 + 2 pattern from the requirements is
 * visible as it is built up.
 *
 * The AI question sits outside the per-project form conceptually -- it is declared once per day and
 * the API upserts it -- so once a declaration exists for the date it is pre-filled and reused.
 */
const emptyForm = {
  projectId: '',
  estimatedHours: '',
  isNoWorkDone: false,
  workDescriptionHtml: '',
  isAiUsed: '',
  aiToolId: '',
  aiUsageRemarks: '',
};

export default function DsrEntryPage() {
  const [metadata, setMetadata] = useState(null);
  const [workDate, setWorkDate] = useState(dayjs().format('YYYY-MM-DD'));
  const [day, setDay] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);

  const { control, handleSubmit, reset, watch, setValue, setError: setFieldError, formState: { errors } } =
    useForm({ defaultValues: emptyForm });

  const isNoWorkDone = watch('isNoWorkDone');
  const isAiUsed = watch('isAiUsed');

  /*
    Metadata is re-fetched whenever the work date changes, not just on mount: the project list is
    filtered server-side to projects that accept effort on that specific date. Fetching once meant
    the dropdown could offer a project whose window had closed, and the user only found out when
    Save failed with "the work date falls outside the window for project X".
  */
  useEffect(() => {
    let cancelled = false;

    dsrApi.metadata(workDate)
      .then((m) => { if (!cancelled) setMetadata(m); })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [workDate]);

  /**
   * @param prefillAi  true when opening a date (helpful to show what is already declared),
   *                   false straight after a save so the form stays cleared as required.
   */
  const loadDay = useCallback(async (date, prefillAi = true) => {
    setLoading(true);
    setError(null);
    try {
      const result = await dsrApi.day(date);
      setDay(result);

      // The day's AI declaration is one answer per date, so it is offered as a starting point when
      // the date is opened -- but never re-applied after a save, which must leave the form empty.
      if (prefillAi && result.isAiUsed !== null && result.isAiUsed !== undefined) {
        setValue('isAiUsed', String(result.isAiUsed));
        setValue('aiToolId', result.aiToolId ?? '');
        setValue('aiUsageRemarks', result.aiUsageRemarks ?? '');
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [setValue]);

  useEffect(() => { if (metadata) loadDay(workDate); }, [workDate, metadata, loadDay]);

  /**
   * ALL projects stay selectable, always. A project is never removed after being logged: an
   * employee may record several pieces of work against the same project on the same day
   * (API Development 4h, Unit Testing 2h, Bug Fixing 1h). The only limit on the day is the
   * employee's standard daily hours, enforced server-side on save.
   */
  const availableProjects = metadata?.projects ?? [];

  /** Projects already logged today, used only to show a hint chip -- never to hide anything. */
  const loggedProjectIds = useMemo(() => new Set(day?.usedProjectIds ?? []), [day]);

  const selectedProjectId = watch('projectId');

  /*  Remaining hours are PER PROJECT, matching the rule the API enforces.
      Previously this subtracted the whole day's total from the cap, so after logging 4h on one
      project every other project also showed "4 remaining" -- wrong, because each project has its
      own allowance. It now counts only the entries already logged against the selected project,
      and resets to the full allowance the moment a different project is chosen. */
  const perProjectCap = day?.maxDailyHours ?? 8;

  const projectLogged = useMemo(() => {
    if (!day || !selectedProjectId) return 0;
    return day.entries
      .filter((e) => e.projectId === Number(selectedProjectId) && e.id !== editingId?.id)
      .reduce((sum, e) => sum + e.estimatedHours, 0);
  }, [day, selectedProjectId, editingId]);

  const remaining = Math.max(0, perProjectCap - projectLogged);

  const onSubmit = async (values) => {
    setSaving(true);
    setError(null);

    const payload = {
      workDate,
      projectId: values.isNoWorkDone ? null : Number(values.projectId),
      estimatedHours: values.isNoWorkDone ? 0 : Number(values.estimatedHours),
      isNoWorkDone: values.isNoWorkDone,
      workDescriptionHtml: values.workDescriptionHtml || null,
      isAiUsed: values.isAiUsed === '' ? null : values.isAiUsed === 'true',
      aiToolId: values.isAiUsed === 'true' ? Number(values.aiToolId) : null,
      aiUsageRemarks: values.aiUsageRemarks || null,
    };

    try {
      if (editingId) {
        const { workDate: _ignored, ...updatePayload } = payload;
        await dsrApi.update(editingId.id, updatePayload);
        setToast('DSR entry updated.');
      } else {
        await dsrApi.create(payload);
        setToast('DSR entry saved. Add another project for this date if needed.');
      }

      /*  Full reset, including the AI tool and remarks.
          These used to be carried over so the day's AI declaration did not have to be re-entered
          for each project, but the requirement is a clean form after every save. The day's saved
          declaration is still visible in the panel on the right, and because the API UPSERTS it
          per (employee, date), re-answering on the next entry updates that one row rather than
          creating a second -- the most recent answer wins for the day. */
      reset(emptyForm);
      setEditingId(null);
      await loadDay(workDate, false);   // false = leave the AI fields cleared
    } catch (e) {
      // Field-level errors from FluentValidation are mapped back onto the form controls.
      if (e.fieldErrors) {
        Object.entries(e.fieldErrors).forEach(([field, messages]) => {
          const name = field.charAt(0).toLowerCase() + field.slice(1);
          setFieldError(name, { type: 'server', message: messages[0] });
        });
      }
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const beginEdit = (entry) => {
    setEditingId({ id: entry.id, projectId: entry.projectId });
    reset({
      projectId: entry.projectId ?? '',
      estimatedHours: entry.estimatedHours ?? '',
      isNoWorkDone: entry.isNoWorkDone,
      workDescriptionHtml: entry.workDescriptionHtml ?? '',
      isAiUsed: day?.isAiUsed === null || day?.isAiUsed === undefined ? '' : String(day.isAiUsed),
      aiToolId: day?.aiToolId ?? '',
      aiUsageRemarks: day?.aiUsageRemarks ?? '',
    });
  };

  const removeEntry = async (entry) => {
    if (!window.confirm(`Remove the ${entry.projectName ?? 'No Work Done'} entry for ${dayjs(workDate).format('DD MMM YYYY')}?`)) return;
    try {
      await dsrApi.remove(entry.id);
      setToast('DSR entry removed.');
      await loadDay(workDate);
    } catch (e) {
      setError(e.message);
    }
  };

  if (loading && !metadata) return <LinearProgress />;

  return (
    <Box>
      <Typography variant="h5" gutterBottom>Daily Status Report</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Save one entry per project. Working on three projects today means three saves.
      </Typography>

      {error && <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>{error}</Alert>}

      <Grid container spacing={2}>
        {/* ------------------------------- ENTRY FORM ------------------------------- */}
        <Grid item xs={12} md={7}>
          <Card component="form" onSubmit={handleSubmit(onSubmit)}>
            <CardContent>
              <Grid container spacing={2}>
                <Grid item xs={12} sm={6}>
                  <TextField
                    label="Work Date" type="date" fullWidth required
                    value={workDate}
                    onChange={(e) => { setWorkDate(e.target.value); setEditingId(null); reset(emptyForm); }}
                    inputProps={{ min: metadata?.minWorkDate, max: metadata?.maxWorkDate }}
                    InputLabelProps={{ shrink: true }}
                    helperText={`Between ${dayjs(metadata?.minWorkDate).format('DD MMM')} and today (${metadata?.backDateWindowDays}-day window). Future dates are not allowed.`}
                  />
                </Grid>

                <Grid item xs={12} sm={6} sx={{ display: 'flex', alignItems: 'center' }}>
                  <Controller
                    name="isNoWorkDone" control={control}
                    render={({ field }) => (
                      <FormControlLabel
                        control={<Checkbox {...field} checked={field.value}
                          onChange={(e) => {
                            field.onChange(e.target.checked);
                            if (e.target.checked) { setValue('projectId', ''); setValue('estimatedHours', 0); }
                          }} />}
                        label="No Work Done"
                      />
                    )}
                  />
                </Grid>

                <Grid item xs={12} sm={7}>
                  <Controller
                    name="projectId" control={control}
                    rules={{ required: !isNoWorkDone && 'Project is required.' }}
                    render={({ field }) => (
                      <FormControl fullWidth required={!isNoWorkDone} disabled={isNoWorkDone} error={Boolean(errors.projectId)}>
                        <InputLabel id="project-label">Project</InputLabel>
                        <Select {...field} labelId="project-label" label="Project">
                          {availableProjects.map((p) => (
                            <MenuItem key={p.id} value={p.id}>
                              <Box component="span" sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                                <span>{p.projectCode} — {p.projectName}</span>
                                {loggedProjectIds.has(p.id) && (
                                  <Chip size="small" variant="outlined" label="logged today" sx={{ ml: 'auto', height: 18, fontSize: 10 }} />
                                )}
                              </Box>
                            </MenuItem>
                          ))}
                        </Select>
                        <FormHelperText>
                          {errors.projectId?.message
                            ?? (isNoWorkDone
                              ? 'Not required when no work was done.'
                              : 'You can log the same project more than once a day.')}
                        </FormHelperText>
                      </FormControl>
                    )}
                  />
                </Grid>

                <Grid item xs={12} sm={5}>
                  <Controller
                    name="estimatedHours" control={control}
                    rules={{
                      required: !isNoWorkDone && 'Hours are required.',
                      min: { value: isNoWorkDone ? 0 : 0.25, message: 'Hours must be greater than zero.' },
                      max: { value: 24, message: 'Hours cannot exceed 24.' },
                    }}
                    render={({ field }) => (
                      <TextField {...field} label="Estimated Hours" type="number" fullWidth
                        required={!isNoWorkDone} disabled={isNoWorkDone}
                        inputProps={{ min: 0, max: 24, step: 0.25 }}
                        error={Boolean(errors.estimatedHours)}
                        helperText={errors.estimatedHours?.message
                          ?? (isNoWorkDone
                            ? 'Not applicable when no work was done.'
                            : !selectedProjectId
                              ? `Up to ${perProjectCap} hour(s) per project for this date.`
                              : `${remaining} of ${perProjectCap} hour(s) remaining for this project on this date.`)} />
                    )}
                  />
                </Grid>

                <Grid item xs={12}>
                  <Controller
                    name="workDescriptionHtml" control={control}
                    rules={{ required: !isNoWorkDone && metadata?.requireDescription && 'Description is required when work has been performed.' }}
                    render={({ field }) => (
                      <RichTextField
                        label="Work Description" value={field.value} onChange={field.onChange}
                        disabled={isNoWorkDone}
                        error={errors.workDescriptionHtml?.message}
                      />
                    )}
                  />
                </Grid>

                <Grid item xs={12}><Divider><Chip label="AI usage — declared once per day" size="small" /></Divider></Grid>

                <Grid item xs={12} sm={5}>
                  <Controller
                    name="isAiUsed" control={control}
                    rules={{ required: 'Please state whether AI was used today.' }}
                    render={({ field }) => (
                      <FormControl error={Boolean(errors.isAiUsed)}>
                        <Typography variant="body2" sx={{ mb: 0.5 }}>AI Used Today *</Typography>
                        <RadioGroup {...field} row
                          onChange={(e) => { field.onChange(e.target.value); if (e.target.value === 'false') setValue('aiToolId', ''); }}>
                          <FormControlLabel value="true" control={<Radio />} label="Yes" />
                          <FormControlLabel value="false" control={<Radio />} label="No" />
                        </RadioGroup>
                        <FormHelperText>{errors.isAiUsed?.message}</FormHelperText>
                      </FormControl>
                    )}
                  />
                </Grid>

                {/* The tool dropdown is hidden entirely when AI = No, per the UI specification. */}
                {isAiUsed === 'true' && (
                  <>
                    <Grid item xs={12} sm={7}>
                      <Controller
                        name="aiToolId" control={control}
                        rules={{ required: 'Select the AI tool you used.' }}
                        render={({ field }) => (
                          <FormControl fullWidth required error={Boolean(errors.aiToolId)}>
                            <InputLabel id="tool-label">AI Tool</InputLabel>
                            <Select {...field} labelId="tool-label" label="AI Tool">
                              {metadata?.aiTools.map((t) => (
                                <MenuItem key={t.id} value={t.id}>{t.toolName}</MenuItem>
                              ))}
                            </Select>
                            <FormHelperText>{errors.aiToolId?.message}</FormHelperText>
                          </FormControl>
                        )}
                      />
                    </Grid>
                    <Grid item xs={12}>
                      <Controller
                        name="aiUsageRemarks" control={control}
                        render={({ field }) => (
                          <TextField {...field} label="AI Usage Remarks" fullWidth multiline rows={2}
                            inputProps={{ maxLength: 1000 }}
                            helperText="Optional: what you used it for, and any time saved." />
                        )}
                      />
                    </Grid>
                  </>
                )}

                <Grid item xs={12}>
                  <Stack direction="row" spacing={1}>
                    <Button type="submit" variant="contained" disabled={saving}
                      startIcon={saving ? <CircularProgress size={16} /> : (editingId ? <SaveIcon /> : <AddIcon />)}>
                      {editingId ? 'Update Entry' : 'Save Entry'}
                    </Button>
                    {editingId && (
                      <Button variant="text" onClick={() => { setEditingId(null); reset(emptyForm); }}>Cancel</Button>
                    )}
                  </Stack>
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        </Grid>

        {/* --------------------------- SAVED ENTRIES FOR THE DATE --------------------------- */}
        <Grid item xs={12} md={5}>
          <Card>
            <CardContent>
              <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
                <Typography variant="subtitle1">{dayjs(workDate).format('DD MMM YYYY')}</Typography>
                <Chip size="small" color={day?.totalHours >= day?.standardDailyHours ? 'success' : 'warning'}
                  label={`${day?.totalHours ?? 0} / ${day?.standardDailyHours ?? 8} h`} />
              </Stack>

              {loading ? <LinearProgress /> : (day?.entries?.length ? (
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Project / Work</TableCell>
                      <TableCell align="right">Hours</TableCell>
                      <TableCell align="right" />
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {day.entries.map((entry) => (
                      <TableRow key={entry.id} hover>
                        {/* The description is shown beneath the project because the same project
                            can now appear several times; without it the rows are indistinguishable. */}
                        <TableCell>
                          {entry.isNoWorkDone ? (
                            <Chip size="small" label="No Work Done" variant="outlined" />
                          ) : (
                            <>
                              <Typography variant="body2">{entry.projectName}</Typography>
                              {entry.workDescriptionPlain && (
                                <Typography variant="caption" color="text.secondary"
                                  sx={{ display: 'block', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {entry.workDescriptionPlain}
                                </Typography>
                              )}
                            </>
                          )}
                        </TableCell>
                        <TableCell align="right">{entry.estimatedHours}</TableCell>
                        <TableCell align="right">
                          <Tooltip title={entry.isEditable ? 'Edit' : 'Outside the editing window'}>
                            <span>
                              <IconButton size="small" disabled={!entry.isEditable} onClick={() => beginEdit(entry)}>
                                <EditOutlinedIcon fontSize="inherit" />
                              </IconButton>
                            </span>
                          </Tooltip>
                          <IconButton size="small" disabled={!entry.isEditable} onClick={() => removeEntry(entry)}>
                            <DeleteOutlineIcon fontSize="inherit" />
                          </IconButton>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <Alert severity="info" variant="outlined">
                  No entries yet for this date. Save your first project above.
                </Alert>
              ))}

              {day?.isAiUsed !== null && day?.isAiUsed !== undefined && (
                <Alert severity="success" variant="outlined" sx={{ mt: 2 }}>
                  AI declaration for this date: <strong>{day.isAiUsed ? `Yes — ${day.aiToolName}` : 'No'}</strong>
                </Alert>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Snackbar open={Boolean(toast)} autoHideDuration={4000} onClose={() => setToast(null)}
        message={toast} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} />
    </Box>
  );
}
