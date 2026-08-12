import { Link as RouterLink, useLocation } from 'react-router-dom';
import { Box, Breadcrumbs, Link, Stack, Typography } from '@mui/material';
import { ChevronRight } from 'lucide-react';
import { breadcrumbsFor } from '../navigation';

/**
 * The standard top-of-page block: breadcrumb trail, 28px title, optional supporting line and a
 * right-hand slot for page actions.
 *
 * Every page uses this, which is what makes the application feel like one product rather than nine
 * screens: the title always sits in the same place, at the same size, with actions always right.
 *
 * @param title        Page title. Rendered as the page's single <h1> for screen readers.
 * @param description  Optional supporting sentence beneath the title.
 * @param actions      Optional node (usually buttons) aligned to the right on desktop.
 */
export default function PageHeader({ title, description, actions }) {
  const { pathname } = useLocation();
  const trail = breadcrumbsFor(pathname);

  return (
    <Box component="header" sx={{ mb: 3 }}>
      {trail.length > 1 && (
        <Breadcrumbs
          separator={<ChevronRight size={13} aria-hidden="true" />}
          aria-label="Breadcrumb"
          sx={{ mb: 1 }}
        >
          {trail.map((crumb, index) =>
            index === trail.length - 1 ? (
              // The current page is not a link, and is announced as such.
              <Typography key={crumb.to} variant="caption" color="text.primary" fontWeight={500} aria-current="page">
                {crumb.label}
              </Typography>
            ) : (
              <Link
                key={crumb.to}
                component={RouterLink}
                to={crumb.to}
                variant="caption"
                underline="hover"
                color="text.secondary"
              >
                {crumb.label}
              </Link>
            ),
          )}
        </Breadcrumbs>
      )}

      <Stack
        direction={{ xs: 'column', md: 'row' }}
        justifyContent="space-between"
        alignItems={{ xs: 'stretch', md: 'flex-end' }}
        spacing={2}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h4" component="h1">{title}</Typography>
          {description && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, maxWidth: 720 }}>
              {description}
            </Typography>
          )}
        </Box>

        {actions && (
          <Stack
            direction="row"
            spacing={1}
            flexWrap="wrap"
            useFlexGap
            sx={{ flexShrink: 0, justifyContent: { xs: 'flex-start', md: 'flex-end' } }}
          >
            {actions}
          </Stack>
        )}
      </Stack>
    </Box>
  );
}
