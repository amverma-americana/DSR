import { useCallback, useEffect, useMemo, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import {
  Alert, Box, Button, Chip, CircularProgress, Divider, FormControl, FormControlLabel,
  FormHelperText, Grid, IconButton, InputLabel, LinearProgress, LinearProgress as Meter, MenuItem,
  Radio, RadioGroup, Select, Snackbar, Stack, Table, TableBody, TableCell, TableHead, TableRow,
  TextField, Tooltip, Typography,
} from '@mui/material';
// `Checkbox` was used only by the commented-out "No Work Done" control; restore the import with it.
import { CalendarDays, Pencil, Plus, Save, Sparkles, Trash2 } from 'lucide-react';
import dayjs from 'dayjs';
import { dsrApi } from '../api/client';
import RichTextField from '../components/RichTextField';
import PageHeader from '../components/PageHeader';
import SectionCard from '../components/SectionCard';
import EmptyState from '../components/EmptyState';
import ConfirmDialog from '../components/ConfirmDialog';
import ProjectSelect from '../components/ProjectSelect';
import { COLORS } from '../theme/tokens';

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
 *
 * The redesign groups the form into three labelled sections (When, What, AI usage) so a long
 * single column of controls reads as a sequence of decisions rather than a wall of inputs. The
 * submit logic, validation rules and payload are untouched.
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

/** Small labelled divider used to open each section of the form. */
const FormSection = ({ step, title, hint }) => (
  <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 0.5 }}>
    <Box
      aria-hidden="true"
      sx={{
        display: 'grid', placeItems: 'center', width: 22, height: 22, borderRadius: '50%',
        bgcolor: COLORS.primaryLight, color: COLORS.primary, fontSize: 11, fontWeight: 700,
      }}
    >
      {step}
    </Box>
    <Box>
      <Typography variant="subtitle1" component="h3">{title}</Typography>
      {hint && <Typography variant="caption" color="text.secondary">{hint}</Typography>}
    </Box>
  </Stack>
);

export default function DsrEntryPage() {
  const [metadata, setMetadata] = useState(null);
  const [workDate, setWorkDate] = useState(dayjs().format('YYYY-MM-DD'));
  const [day, setDay] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [pendingRemoval, setPendingRemoval] = useState(null);

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

  /*  Projects already logged today. This drove a "logged today" hint chip on each dropdown option,
      removed with the simplification to project-name-only display. Nothing about the RULE changed:
      a project may still be logged any number of times a day, and the saved-entries panel on the
      right already shows what has been recorded. Retained for reactivation alongside the chip.

      const loggedProjectIds = useMemo(() => new Set(day?.usedProjectIds ?? []), [day]);          */

  const selectedProjectId = watch('projectId');

  /*  DAILY HOURS LIMITS REMOVED as per current business requirement.
      8 hours is the utilisation BENCHMARK, not a ceiling -- so there is no "remaining" allowance
      to count down and nothing to warn about. `perProjectCap` and `remaining` are retained below
      for reactivation; the helper text that quoted them has been replaced with a plain statement
      of how much is already on the project, which is useful information without implying a limit.

      const perProjectCap = day?.maxDailyHours ?? 8;
      const remaining = Math.max(0, perProjectCap - projectLogged);                              */

  /*  Still computed, and still shown -- but now purely informational: "4h already logged against
      this project today" helps an employee avoid double-entering, without blocking anything.  */
  const projectLogged = useMemo(() => {
    if (!day || !selectedProjectId) return 0;
    return day.entries
      .filter((e) => e.projectId === Number(selectedProjectId) && e.id !== editingId?.id)
      .reduce((sum, e) => sum + e.estimatedHours, 0);
  }, [day, selectedProjectId, editingId]);

  const dayTotal = day?.totalHours ?? 0;
  /*  The benchmark for the utilisation reading, from the employee's StandardDailyHours (8 by
      default). It is a denominator now, never a limit.  */
  const benchmarkHours = day?.standardDailyHours ?? 8;

  /*  Utilisation is UNCAPPED -- 25 hours against an 8-hour benchmark reads 312%, matching the
      report. The previous Math.min(100, ...) clamp would have shown 100% for both a full day and
      a triple day, hiding exactly the over-logging this change makes possible.
      The progress BAR is still clamped to 100 because a bar cannot render past its track; the
      figure beside it carries the real number.  */
  const dayUtilisationPct = Math.round((dayTotal / (benchmarkHours || 1)) * 100);
  const dayProgress = Math.min(100, dayUtilisationPct);

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
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  /*  Removal is gated by a styled confirmation dialog rather than window.confirm. The gate itself
      is unchanged -- nothing is deleted until the user confirms -- but the prompt can now state
      which entry and which date are affected in readable type.  */
  const confirmRemoval = async () => {
    const entry = pendingRemoval;
    setPendingRemoval(null);
    if (!entry) return;

    try {
      await dsrApi.remove(entry.id);
      setToast('DSR entry removed.');
      await loadDay(workDate);
    } catch (e) {
      setError(e.message);
    }
  };

  if (loading && !metadata) return <LinearProgress aria-label="Loading DSR form" />;

  return (
    <Box>
      <PageHeader
        title="Daily Status Report"
        description="Save one entry per project. Working on three projects today means three saves."
      />

      {error && <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 3 }}>{error}</Alert>}

      <Grid container spacing={2.5}>
        {/* ------------------------------- ENTRY FORM ------------------------------- */}
        <Grid item xs={12} lg={7}>
          <SectionCard
            title={editingId ? 'Edit entry' : 'New entry'}
            subtitle={editingId ? 'Updating an existing entry for this date.' : 'Record work against a single project.'}
            action={editingId ? <Chip size="small" color="warning" label="Editing" /> : null}
          >
            <Box component="form" onSubmit={handleSubmit(onSubmit)} noValidate>
              <Stack spacing={3} sx={{ mt: 1 }}>
                {/* ---------------------------------------------------------- 1. when */}
                <Box>
                  <FormSection step="1" title="When" hint="The date this work was performed." />
                  <Grid container spacing={2} sx={{ mt: 0 }}>
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

                    {/* ---------------------------------------------------------------------------
                        "No Work Done" commented out from the UI as per current requirement.

                        The FIELD is not gone -- isNoWorkDone stays on the form defaults as false,
                        so every save posts isNoWorkDone: false and the API contract is unchanged.
                        Consequently Project, Estimated Hours and Work Description are now always
                        required, which is exactly what an entry describing real work needs. All the
                        `!isNoWorkDone && ...` validation rules below are left intact and simply
                        evaluate as "work was done".

                        Historical entries that ARE flagged no-work-done still render correctly: the
                        saved-entries panel further down keeps its "No Work Done" chip, and the DSR
                        Reports "No Work Done" tab still reports them. Only the INPUT is hidden --
                        1 such row exists in the database today and must not become unreadable.

                        To restore, uncomment this block. Nothing server-side needs changing.
                        --------------------------------------------------------------------------- */}
                    {/*
                    <Grid item xs={12} sm={6} sx={{ display: 'flex', alignItems: 'flex-start' }}>
                      <Controller
                        name="isNoWorkDone" control={control}
                        render={({ field }) => (
                          <Box
                            sx={{
                              width: '100%', height: 48, px: 2, display: 'flex', alignItems: 'center',
                              border: `1px solid ${COLORS.border}`, borderRadius: 2.5,
                              bgcolor: field.value ? COLORS.warningLight : 'transparent',
                              borderColor: field.value ? COLORS.warning : COLORS.border,
                              transition: 'background-color .15s ease, border-color .15s ease',
                            }}
                          >
                            <FormControlLabel
                              sx={{ m: 0 }}
                              control={(
                                <Checkbox
                                  {...field} checked={field.value} size="small"
                                  onChange={(e) => {
                                    field.onChange(e.target.checked);
                                    if (e.target.checked) { setValue('projectId', ''); setValue('estimatedHours', 0); }
                                  }}
                                />
                              )}
                              label={<Typography variant="body2">No Work Done</Typography>}
                            />
                          </Box>
                        )}
                      />
                    </Grid>
                    */}
                  </Grid>
                </Box>

                <Divider />

                {/* ---------------------------------------------------------- 2. what */}
                <Box>
                  <FormSection step="2" title="What you worked on" hint="One project per entry; log the same project again for separate tasks." />
                  <Grid container spacing={2} sx={{ mt: 0 }}>
                    <Grid item xs={12} sm={7}>
                      <Controller
                        name="projectId" control={control}
                        rules={{ required: !isNoWorkDone && 'Project is required.' }}
                        render={({ field }) => (
                          <ProjectSelect
                            projects={availableProjects}
                            value={field.value}
                            onChange={field.onChange}
                            label="Project"
                            required={!isNoWorkDone}
                            disabled={isNoWorkDone}
                            error={Boolean(errors.projectId)}
                            helperText={errors.projectId?.message
                              ?? (isNoWorkDone
                                ? 'Not required when no work was done.'
                                : 'You can log the same project more than once a day.')}
                          />
                        )}
                      />
                    </Grid>

                    <Grid item xs={12} sm={5}>
                      <Controller
                        name="estimatedHours" control={control}
                        /*  DAILY HOURS LIMITS REMOVED as per current business requirement.
                            The 8-hour rules are gone. What remains is a 24-hour bound on a SINGLE
                            entry, which is not a daily limit: a day may total 25h+ across several
                            entries, but one entry claiming more than 24 hours is physically
                            impossible and is nearly always a typo (80 for 8). It matches
                            CK_DSREntries_HoursRange and the FluentValidation rule, so leaving it
                            in place means the user sees a clear field message instead of a raw
                            database error.                                                       */
                        rules={{
                          required: !isNoWorkDone && 'Hours are required.',
                          min: { value: isNoWorkDone ? 0 : 0.25, message: 'Hours must be greater than zero.' },
                          max: { value: 24, message: 'A single entry cannot exceed 24 hours.' },
                        }}
                        render={({ field }) => (
                          <TextField {...field} label="Estimated Hours" type="number" fullWidth
                            required={!isNoWorkDone} disabled={isNoWorkDone}
                            inputProps={{ min: 0, max: 24, step: 0.25 }}
                            error={Boolean(errors.estimatedHours)}
                            /*  No "remaining" or "up to N hours" wording: there is no allowance to
                                spend. When a project already has time on it, that is stated as a
                                fact rather than as a budget.                                     */
                            helperText={errors.estimatedHours?.message
                              ?? (isNoWorkDone
                                ? 'Not applicable when no work was done.'
                                : projectLogged > 0
                                  ? `${projectLogged} hour(s) already logged against this project on this date.`
                                  : 'Log the hours you spent. There is no daily limit.')} />
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
                  </Grid>
                </Box>

                <Divider />

                {/* ---------------------------------------------------------- 3. ai */}
                <Box>
                  <FormSection step="3" title="AI usage" hint="Declared once per day, not per project." />
                  <Grid container spacing={2} sx={{ mt: 0 }}>
                    <Grid item xs={12} sm={5}>
                      <Controller
                        name="isAiUsed" control={control}
                        rules={{ required: 'Please state whether AI was used today.' }}
                        render={({ field }) => (
                          <FormControl error={Boolean(errors.isAiUsed)} component="fieldset">
                            <Typography component="legend" variant="subtitle2" sx={{ mb: 0.5 }}>
                              AI Used Today *
                            </Typography>
                            <RadioGroup {...field} row
                              onChange={(e) => { field.onChange(e.target.value); if (e.target.value === 'false') setValue('aiToolId', ''); }}>
                              <FormControlLabel value="true" control={<Radio size="small" />} label={<Typography variant="body2">Yes</Typography>} />
                              <FormControlLabel value="false" control={<Radio size="small" />} label={<Typography variant="body2">No</Typography>} />
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
                              <TextField {...field} label="AI Usage Remarks" fullWidth multiline minRows={2}
                                inputProps={{ maxLength: 1000 }}
                                helperText="Optional: what you used it for, and any time saved." />
                            )}
                          />
                        </Grid>
                      </>
                    )}
                  </Grid>
                </Box>

                <Divider />

                <Stack direction="row" spacing={1.5}>
                  <Button type="submit" variant="contained" disabled={saving}
                    startIcon={saving ? <CircularProgress size={15} color="inherit" /> : (editingId ? <Save size={16} /> : <Plus size={16} />)}>
                    {editingId ? 'Update Entry' : 'Save Entry'}
                  </Button>
                  {editingId && (
                    <Button variant="text" onClick={() => { setEditingId(null); reset(emptyForm); }}>Cancel</Button>
                  )}
                </Stack>
              </Stack>
            </Box>
          </SectionCard>
        </Grid>

        {/* --------------------------- SAVED ENTRIES FOR THE DATE --------------------------- */}
        <Grid item xs={12} lg={5}>
          <SectionCard
            title={dayjs(workDate).format('DD MMM YYYY')}
            subtitle="Entries saved for this date"
            action={(
              <Chip
                size="small"
                color={dayTotal >= benchmarkHours ? 'success' : 'warning'}
                label={`${dayTotal} / ${benchmarkHours} h`}
              />
            )}
            noPadding
            dividing
          >
            {/*  Utilisation against the 8-hour BENCHMARK, not progress towards a limit.
                 The bar fills to 100% and stops (a track cannot render past its end), while the
                 caption reports the true figure -- so a 12-hour day reads "150% of the 8h
                 benchmark" rather than silently looking identical to an 8-hour day.            */}
            <Box sx={{ px: 3, pt: 2 }}>
              <Meter
                variant="determinate"
                value={dayProgress}
                aria-label={`Hours logged against the ${benchmarkHours} hour benchmark`}
                sx={{
                  height: 6, borderRadius: 3,
                  '& .MuiLinearProgress-bar': {
                    borderRadius: 3,
                    backgroundColor: dayTotal >= benchmarkHours ? COLORS.success : COLORS.primary,
                  },
                }}
              />
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
                {dayUtilisationPct}% of the {benchmarkHours}h benchmark
                {dayUtilisationPct > 100 && ' — above benchmark, which is allowed'}
              </Typography>
            </Box>

            {loading ? (
              <LinearProgress sx={{ mt: 2 }} />
            ) : day?.entries?.length ? (
              <Table size="small" sx={{ mt: 1.5 }}>
                <TableHead>
                  <TableRow>
                    <TableCell>Project / Work</TableCell>
                    <TableCell align="right">Hours</TableCell>
                    <TableCell align="right">Actions</TableCell>
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
                            <Typography variant="body2" fontWeight={500}>{entry.projectName}</Typography>
                            {entry.workDescriptionPlain && (
                              <Typography variant="caption" color="text.secondary"
                                sx={{ display: 'block', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {entry.workDescriptionPlain}
                              </Typography>
                            )}
                          </>
                        )}
                      </TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600 }}>{entry.estimatedHours}</TableCell>
                      <TableCell align="right">
                        <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                          <Tooltip title={entry.isEditable ? 'Edit entry' : 'Outside the editing window'}>
                            <span>
                              <IconButton size="small" disabled={!entry.isEditable} onClick={() => beginEdit(entry)}
                                aria-label={`Edit ${entry.projectName ?? 'No Work Done'} entry`}>
                                <Pencil size={15} />
                              </IconButton>
                            </span>
                          </Tooltip>
                          <Tooltip title={entry.isEditable ? 'Remove entry' : 'Outside the editing window'}>
                            <span>
                              <IconButton size="small" disabled={!entry.isEditable} onClick={() => setPendingRemoval(entry)}
                                aria-label={`Remove ${entry.projectName ?? 'No Work Done'} entry`}
                                sx={{ '&:hover': { color: 'error.main' } }}>
                                <Trash2 size={15} />
                              </IconButton>
                            </span>
                          </Tooltip>
                        </Stack>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <EmptyState
                compact icon={CalendarDays} title="No entries yet"
                description="Save your first project for this date using the form."
              />
            )}

            {day?.isAiUsed !== null && day?.isAiUsed !== undefined && (
              <Box sx={{ px: 3, pb: 3, pt: 2 }}>
                <Stack
                  direction="row" spacing={1.5} alignItems="center"
                  sx={{
                    p: 1.5, borderRadius: 2.5,
                    bgcolor: day.isAiUsed ? COLORS.successLight : COLORS.surface,
                    border: `1px solid ${day.isAiUsed ? '#BBF7D0' : COLORS.border}`,
                  }}
                >
                  <Sparkles size={16} color={day.isAiUsed ? COLORS.success : COLORS.textSecondary} aria-hidden="true" />
                  <Typography variant="body2">
                    AI declaration for this date:{' '}
                    <strong>{day.isAiUsed ? `Yes — ${day.aiToolName}` : 'No'}</strong>
                  </Typography>
                </Stack>
              </Box>
            )}
          </SectionCard>
        </Grid>
      </Grid>

      <ConfirmDialog
        open={Boolean(pendingRemoval)}
        onClose={() => setPendingRemoval(null)}
        title="Remove this entry?"
        message={pendingRemoval
          ? `The ${pendingRemoval.projectName ?? 'No Work Done'} entry for ${dayjs(workDate).format('DD MMM YYYY')} will be removed. This cannot be undone.`
          : ''}
        confirmLabel="Remove entry"
        onConfirm={confirmRemoval}
      />

      <Snackbar open={Boolean(toast)} autoHideDuration={4000} onClose={() => setToast(null)}
        message={toast} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} />
    </Box>
  );
}
