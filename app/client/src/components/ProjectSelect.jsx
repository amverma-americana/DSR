import { useMemo } from 'react';
import { Autocomplete, Box, Stack, TextField, Typography } from '@mui/material';
import { FolderKanban } from 'lucide-react';

/*  Project status is no longer surfaced in this control -- see the note on DISPLAY below.
    Retained for reactivation if a screen ever needs to distinguish statuses inline again.
    Reactivating it also needs `import { COLORS } from '../theme/tokens';` restored above.

    const STATUS_TONE = {
      ACTIVE: { fg: COLORS.success, bg: COLORS.successLight },
      PLANNED: { fg: COLORS.primary, bg: COLORS.primaryLight },
      ON_HOLD: { fg: COLORS.warning, bg: COLORS.warningLight },
      COMPLETED: { fg: COLORS.textSecondary, bg: COLORS.surface },
      CANCELLED: { fg: COLORS.danger, bg: COLORS.dangerLight },
    };                                                                                        */

/**
 * Searchable project picker, replacing the plain <Select> the DSR form and the filter bars used.
 *
 * ---------------------------------------------------------------------------------------------
 * DISPLAY: PROJECT NAME ONLY
 * ---------------------------------------------------------------------------------------------
 * The list shows nothing but the project name -- no status suffix, no code, no chips:
 *
 *     Project A          not     Project A (Active)
 *     Project B                  Project B (Active)
 *
 * Status was noise here. The backend already restricts this list to projects that accept effort
 * on the chosen date (active, open-for-effort status, inside the project window), so every option
 * offered is by definition selectable -- printing "(Active)" against all of them told the employee
 * nothing and cost a line of reading on every row.
 *
 * SEARCH still matches project CODE as well as name, even though the code is not displayed: people
 * often know a project as "PRJ-014". Typing that still finds it; it simply is not printed back.
 * ---------------------------------------------------------------------------------------------
 *
 * The component is deliberately id-in / id-out: `value` is a project id (or '' for none) and
 * `onChange` receives a project id (or '' ). That is exactly the contract the previous <Select>
 * had, so callers keep their existing form wiring, validation rules and payload construction.
 *
 * @param projects     Array of projects. Only id / projectName are required.
 * @param value        Selected project id, or '' for none.
 * @param onChange     Called with the new project id, or '' when cleared.
 * @param allLabel     Placeholder wording for filter contexts, where clearing means "all".
 */
export default function ProjectSelect({
  projects = [], value, onChange, label = 'Project', required = false, disabled = false,
  error = false, helperText, allLabel, size, placeholder,
}) {
  // Autocomplete needs the option OBJECT, while callers hold only the id.
  const selected = useMemo(
    () => projects.find((p) => String(p.id) === String(value)) ?? null,
    [projects, value],
  );

  return (
    <Autocomplete
      options={projects}
      value={selected}
      onChange={(_event, option) => onChange(option ? option.id : '')}
      disabled={disabled}
      size={size}
      fullWidth
      autoHighlight
      openOnFocus
      clearOnBlur
      handleHomeEndKeys
      /*  The selected value renders as the project NAME alone -- this is what appears in the
          closed input. Code and status are deliberately absent; see DISPLAY above.  */
      getOptionLabel={(option) => option?.projectName ?? ''}
      /*  ...but matching still considers the code, so "PRJ-014" finds the project even though the
          code is never printed. Without this the code would become unsearchable the moment it
          stopped being part of the label.  */
      filterOptions={(options, { inputValue }) => {
        const needle = inputValue.trim().toLowerCase();
        if (!needle) return options;
        return options.filter((o) =>
          (o.projectName ?? '').toLowerCase().includes(needle)
          || (o.projectCode ?? '').toLowerCase().includes(needle));
      }}
      isOptionEqualToValue={(option, val) => String(option.id) === String(val?.id)}
      noOptionsText={allLabel ? 'No projects match' : 'No projects available for this date'}
      renderOption={(props, option) => {
        const { key, ...optionProps } = props;

        return (
          <Box component="li" key={key} {...optionProps}>
            <Stack direction="row" alignItems="center" spacing={1.5} sx={{ width: '100%', py: 0.25 }}>
              <Box aria-hidden="true" sx={{ color: 'text.disabled', display: 'grid', placeItems: 'center' }}>
                <FolderKanban size={16} />
              </Box>
              <Typography variant="body2" noWrap sx={{ minWidth: 0, flexGrow: 1 }}>
                {option.projectName}
              </Typography>
            </Stack>
          </Box>
        );
      }}
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          required={required}
          error={error}
          helperText={helperText}
          placeholder={placeholder ?? (allLabel ?? 'Search by name or code')}
        />
      )}
    />
  );
}
