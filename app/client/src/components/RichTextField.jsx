import { useEffect, useRef, useState } from 'react';
import { Box, FormHelperText, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import { Bold, Italic, List, ListOrdered } from 'lucide-react';
import { COLORS, RADIUS, SHADOWS } from '../theme/tokens';

/**
 * Minimal dependency-free rich text field built on contentEditable.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY THIS IS NOT A CONTROLLED COMPONENT (this is the fix for reversed typing)
 * ---------------------------------------------------------------------------------------------
 * The previous version rendered `dangerouslySetInnerHTML={{ __html: value }}` on the editable div
 * and called onChange on every keystroke. That created this loop:
 *
 *     type "A"  ->  onChange("A")  ->  parent state updates  ->  re-render
 *               ->  React rewrites the div's innerHTML  ->  the text node is REPLACED
 *               ->  the browser caret has nowhere to be restored to, so it collapses to offset 0
 *               ->  the next character is inserted at the START
 *
 * Typing "Amrit" therefore produced "tirmA": every new character landed in front of the previous
 * one. The characters were never reversed by any string operation, and nothing was wrong with the
 * data — the caret was being reset by React re-writing the DOM underneath the cursor.
 *
 * A contentEditable element owns its own DOM. So it is treated as UNCONTROLLED: the browser is the
 * source of truth while the user types, and `value` is pushed into the DOM only when it differs
 * from what is already there — i.e. for genuinely external changes (loading an entry to edit,
 * resetting the form after save). During typing the two are already equal, so no write happens,
 * the DOM is never touched, and the caret stays exactly where the user put it.
 * ---------------------------------------------------------------------------------------------
 */
export default function RichTextField({ label, value, onChange, disabled, error, placeholder }) {
  const ref = useRef(null);

  // Presentation only: drives the focus ring on the wrapper, so the editor matches the focus
  // treatment of the MUI inputs around it. It never touches the editor's content.
  const [focused, setFocused] = useState(false);

  // Mirrors what we last handed to the parent, so an echo of our own value is not written back.
  const lastEmitted = useRef(value ?? '');

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const incoming = value ?? '';

    // Only touch the DOM for EXTERNAL changes. If `incoming` matches what the user just typed
    // (or what the element already contains) we must not rewrite innerHTML, or the caret resets.
    if (incoming === lastEmitted.current || incoming === el.innerHTML) return;

    el.innerHTML = incoming;
    lastEmitted.current = incoming;
  }, [value]);

  const emit = () => {
    const html = ref.current?.innerHTML ?? '';
    lastEmitted.current = html;
    onChange(html);
  };

  const exec = (command) => {
    ref.current?.focus();
    document.execCommand(command, false, null);
    emit();
  };

  /**
   * Paste as plain text. Browsers otherwise paste full source markup (fonts, colours, classes,
   * even <script>), almost all of which the server sanitiser strips anyway — so the user would see
   * their formatting silently disappear on save. Inserting plain text keeps what is shown and what
   * is stored consistent.
   */
  const handlePaste = (event) => {
    event.preventDefault();
    const text = (event.clipboardData || window.clipboardData).getData('text/plain');
    document.execCommand('insertText', false, text);
    emit();
  };

  const isEmpty = !value || value === '<br>' || value === '<div><br></div>';

  const borderColour = error ? COLORS.danger : focused ? COLORS.primary : COLORS.border;

  return (
    <Box>
      <Typography variant="subtitle2" sx={{ mb: 0.75, color: 'text.secondary' }}>
        {label}{!disabled && ' *'}
      </Typography>

      {/*  Toolbar and editor share one bordered container so the control reads as a single field,
           the way the outlined text inputs beside it do.  */}
      <Box
        sx={{
          border: `1px solid ${borderColour}`,
          borderRadius: `${RADIUS.control}px`,
          overflow: 'hidden',
          bgcolor: disabled ? COLORS.surface : COLORS.card,
          boxShadow: focused && !error ? SHADOWS.focusRing : 'none',
          transition: 'border-color .15s ease, box-shadow .15s ease',
        }}
      >
        <Stack
          direction="row"
          spacing={0.25}
          sx={{ px: 1, py: 0.75, borderBottom: `1px solid ${COLORS.border}`, bgcolor: COLORS.surface }}
        >
          {[['bold', Bold, 'Bold'], ['italic', Italic, 'Italic'],
            ['insertUnorderedList', List, 'Bulleted list'], ['insertOrderedList', ListOrdered, 'Numbered list']]
            .map(([command, Icon, title]) => (
              <Tooltip key={command} title={title}>
                <span>
                  <IconButton
                    size="small" disabled={disabled} aria-label={title}
                    // onMouseDown + preventDefault keeps focus (and the selection) inside the editor;
                    // onClick would blur it first and the command would apply to nothing.
                    onMouseDown={(e) => { e.preventDefault(); exec(command); }}
                    sx={{ width: 30, height: 30, color: 'text.secondary', '&:hover': { color: 'text.primary' } }}
                  >
                    <Icon size={15} />
                  </IconButton>
                </span>
              </Tooltip>
            ))}
        </Stack>

        <Box
          ref={ref}
          component="div"
          contentEditable={!disabled}
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label={label}
          data-placeholder={placeholder ?? 'Describe the work you completed...'}
          onInput={emit}
          onFocus={() => setFocused(true)}
          onBlur={() => { setFocused(false); emit(); }}
          onPaste={handlePaste}
          /*  NOTE: deliberately NO dangerouslySetInnerHTML and NO children.
              React must never re-render the contents of this node; see the header comment. */
          sx={{
            minHeight: 132,
            p: 1.75,
            overflowY: 'auto',
            direction: 'ltr',          // explicit: never inherit an RTL direction from a parent
            textAlign: 'left',
            unicodeBidi: 'normal',
            whiteSpace: 'pre-wrap',    // preserve the user's spacing and newlines
            fontSize: 14,
            lineHeight: 1.55,
            color: disabled ? 'text.disabled' : 'text.primary',
            // The wrapper carries the focus treatment, so the node itself must not draw its own.
            '&:focus': { outline: 'none' },
            '&:empty:before': {
              content: 'attr(data-placeholder)',
              color: COLORS.textTertiary,
              pointerEvents: 'none',
            },
            '& p': { m: 0 },
            '& ul, & ol': { my: 0, pl: 3 },
          }}
        />
      </Box>

      {error
        ? <FormHelperText error>{error}</FormHelperText>
        : isEmpty && !disabled
          ? <FormHelperText>Required when work has been performed.</FormHelperText>
          : null}
    </Box>
  );
}
