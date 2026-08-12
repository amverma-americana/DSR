import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material';
import theme from '../theme/theme';

/**
 * RENDER SMOKE TESTS.
 *
 * Purpose: prove every redesigned page MOUNTS and paints its heading against realistic API data.
 * A Vite build only proves the code parses and resolves its imports -- it cannot catch a component
 * that throws on mount because a field is read off a null, an icon is used as a value, or a prop
 * shape changed. Those are exactly the failures a whole-application restyle introduces.
 *
 * The API layer is mocked, so nothing here touches the network or the database. Each fixture
 * mirrors the real DTO shape, including the fields the pages index into.
 */

/* --------------------------------------------------------------------------- fixtures */

const dayFixture = {
  entries: [
    {
      id: 1, projectId: 10, projectName: 'Project A', estimatedHours: 4, isNoWorkDone: false,
      workDescriptionHtml: '<p>Built the thing</p>', workDescriptionPlain: 'Built the thing',
      isEditable: true,
    },
    { id: 2, projectId: 11, projectName: 'Project B', estimatedHours: 2, isNoWorkDone: false, isEditable: false },
  ],
  usedProjectIds: [10, 11],
  totalHours: 6, standardDailyHours: 8, maxDailyHours: 8,
  isAiUsed: true, aiToolId: 1, aiToolName: 'Claude', aiUsageRemarks: 'Drafting',
};

const metadataFixture = {
  projects: [
    { id: 10, projectCode: 'PRJ-A', projectName: 'Project A', status: 'ACTIVE' },
    { id: 11, projectCode: 'PRJ-B', projectName: 'Project B', status: 'COMPLETED' },
  ],
  aiTools: [{ id: 1, toolName: 'Claude' }],
  minWorkDate: '2026-08-01', maxWorkDate: '2026-08-12', backDateWindowDays: 7, requireDescription: true,
};

const employeeDashboard = {
  todayHours: 6, standardDailyHours: 8, hasSubmittedToday: true, weekHours: 30, monthHours: 120,
  missingDaysThisMonth: 1, monthAiAdoptionPct: 62,
  // 14 entries so the week-on-week trend actually computes.
  last14Days: Array.from({ length: 14 }, (_, i) => ({
    workDate: `2026-07-${String(20 + i).padStart(2, '0')}`,
    entryCount: 2, totalHours: 6 + (i % 3), dayUtilizationPct: 75 + (i % 4) * 10,
  })),
  topProjectsThisMonth: [
    { projectId: 10, projectName: 'Project A', totalHours: 60 },
    { projectId: 11, projectName: 'Project B', totalHours: 40 },
  ],
};

const managerDashboard = {
  teamSize: 5, teamHoursThisMonth: 500, teamAvgUtilizationPct: 84, teamMissingDsrCount: 2,
  utilization: [
    { userId: 1, employeeName: 'Priya Sharma', loggedHours: 120, capacityHours: 140, utilizationPct: 86, ragStatus: 'GREEN' },
    { userId: 2, employeeName: 'Amrit Verma', loggedHours: 80, capacityHours: 140, utilizationPct: 57, ragStatus: 'RED' },
  ],
  missingDsr: [{ userId: 2, employeeName: 'Amrit Verma', missingDayCount: 2 }],
};

const adminDashboard = {
  activeUsers: 24, totalUsers: 30, activeProjects: 8, totalProjects: 12,
  dsrEntriesThisMonth: 420, orgAiAdoptionPct: 58,
  topProjects: [
    { projectId: 10, projectCode: 'PRJ-A', projectName: 'Project A', contributorCount: 6, totalHours: 240, sharePct: 45 },
    { projectId: 11, projectCode: 'PRJ-B', projectName: 'Project B', contributorCount: 4, totalHours: 180, sharePct: 34 },
  ],
};

const detailRows = {
  rows: {
    items: [{
      dsrEntryId: 1, employeeName: 'Priya Sharma', employeeEmail: 'priya@contoso.com', employeeCode: 'EMP-1',
      projectName: 'Project A', taskDescription: 'Built the thing', workCategoryName: 'Development',
      hoursLogged: 6, estimatedHours: 6, remainingHours: 2, isNoWorkDone: false,
      /*  Work date and entry timestamp are deliberately DIFFERENT dates (a back-dated entry:
          effort on the 10th, recorded on the 12th) so any swap between the two fails the test. */
      dsrDate: '2026-08-10', taskEntryDate: '2026-08-12T05:31:00', submissionDate: '2026-08-10T09:30:00Z',
      approvalStatus: 'Submitted', statusCode: 'SUBMITTED', departmentName: 'IT', managerName: 'A Manager',
    }],
    totalCount: 1,
  },
  summary: {
    totalEntries: 1, employeeCount: 1, projectCount: 1, departmentCount: 1,
    totalHoursLogged: 6, totalEstimatedHours: 6, aiAdoptionPct: 50,
    totalRemainingHours: 2, pendingApprovalCount: 1, approvedCount: 0, returnedCount: 0, noWorkDoneCount: 0,
  },
};

const usersPage = {
  items: [{
    id: 1, fullName: 'Priya Sharma', email: 'priya@contoso.com', employeeCode: 'EMP-1',
    roles: ['EMPLOYEE'], managerName: 'A Manager', authenticationType: 'DATABASE',
    standardDailyHours: 8, isActive: true,
  }],
  totalCount: 1,
};

const projectRows = {
  items: [{
    id: 10, projectCode: 'PRJ-A', projectName: 'Project A', status: 'ACTIVE',
    startDate: '2026-01-01', endDate: null, projectManagerName: 'A Manager',
    allocatedResourceCount: 3, isOpenForEffort: true, isActive: true,
  }],
  totalCount: 1,
};

/* --------------------------------------------------------------------------- mocks */

vi.mock('../api/client', () => ({
  tokenStore: {
    getAccessToken: () => null, setAccessToken: () => {},
    getRefreshToken: () => null, setRefreshToken: () => {},
    clear: () => {}, onSessionExpired: () => {},
  },
  authApi: {
    me: vi.fn().mockResolvedValue(null), login: vi.fn(), ssoLogin: vi.fn(), logout: vi.fn(),
    changePassword: vi.fn(), resetPassword: vi.fn().mockResolvedValue({ temporaryPassword: 'Temp#12345' }),
  },
  dsrApi: {
    metadata: vi.fn().mockResolvedValue(metadataFixture),
    day: vi.fn().mockResolvedValue(dayFixture),
    search: vi.fn().mockResolvedValue({
      items: [{
        id: 1, workDate: '2026-08-10', employeeName: 'Priya Sharma', projectName: 'Project A',
        estimatedHours: 6, isAiUsed: true, aiToolName: 'Claude',
        workDescriptionPlain: 'Built the thing', isNoWorkDone: false,
      }],
      totalCount: 1,
    }),
    create: vi.fn(), update: vi.fn(), remove: vi.fn(),
  },
  dashboardApi: {
    employee: vi.fn().mockResolvedValue(employeeDashboard),
    manager: vi.fn().mockResolvedValue(managerDashboard),
    admin: vi.fn().mockResolvedValue(adminDashboard),
  },
  reportsApi: {
    employee: vi.fn().mockResolvedValue({ items: [{ userId: 1, employeeName: 'Priya Sharma', managerName: 'M', entryCount: 4, daysLogged: 3, projectCount: 2, totalHours: 20, avgHoursPerLoggedDay: 6.7, aiAdoptionPct: 50 }], totalCount: 1 }),
    project: vi.fn().mockResolvedValue({ items: [], totalCount: 0 }),
    utilization: vi.fn().mockResolvedValue({ items: [], totalCount: 0 }),
    dailySummary: vi.fn().mockResolvedValue({ items: [], totalCount: 0 }),
    monthlySummary: vi.fn().mockResolvedValue({ items: [], totalCount: 0 }),
    missingDsr: vi.fn().mockResolvedValue([]),
    aiUsage: vi.fn().mockResolvedValue({
      overallAdoptionPct: 58, aiUsedDeclarations: 29, totalDeclarations: 50,
      byTool: [{ aiToolId: 1, toolName: 'Claude', usageDayCount: 20, sharePct: 69 }],
    }),
    exportCsv: vi.fn(),
  },
  adminReportsApi: {
    dsrDetails: vi.fn().mockResolvedValue(detailRows),
    noWorkDone: vi.fn().mockResolvedValue(detailRows),
    grouped: vi.fn().mockResolvedValue([{
      groupId: 1, groupName: 'Priya Sharma', groupSubtitle: 'IT', entryCount: 4, employeeCount: 1,
      projectCount: 2, daysLogged: 3, totalHoursLogged: 20, totalEstimatedHours: 22,
      averageHoursPerDay: 6.7, pendingApprovalCount: 1, approvedCount: 3, returnedCount: 0, sharePct: 40,
    }]),
    missingDsr: vi.fn().mockResolvedValue([]),
    exportReport: vi.fn(),
    /*  Approval workflow disabled as per current business requirement.
        `review` and `approvalStatus` are deliberately ABSENT from this mock so it mirrors the real
        client's surface. If a page ever calls one again the test crashes on "not a function"
        instead of silently passing against a mock the production module no longer provides.  */
  },
  usersApi: {
    search: vi.fn().mockResolvedValue(usersPage),
    team: vi.fn().mockResolvedValue([{ id: 1, name: 'Priya Sharma' }]),
    managers: vi.fn().mockResolvedValue([{ id: 2, name: 'A Manager' }]),
    create: vi.fn(), update: vi.fn(), setActive: vi.fn(),
  },
  projectsApi: {
    search: vi.fn().mockResolvedValue(projectRows),
    allocations: vi.fn().mockResolvedValue([]),
    create: vi.fn(), update: vi.fn(), setActive: vi.fn(),
    saveAllocation: vi.fn(), removeAllocation: vi.fn(),
  },
  mastersApi: {
    settings: vi.fn().mockResolvedValue([
      { settingKey: 'DSR.MaxDailyHours', settingValue: '8', dataType: 'INT', description: 'Cap per project per day', isEditable: true },
      { settingKey: 'DSR.Locked', settingValue: 'x', dataType: 'STRING', description: 'Read only', isEditable: false },
    ]),
    departments: vi.fn().mockResolvedValue([]),
    workCategories: vi.fn().mockResolvedValue([]),
    aiTools: vi.fn().mockResolvedValue([]),
    holidays: vi.fn().mockResolvedValue([]),
    updateSetting: vi.fn(),
  },
}));

/** Mocks the auth context so role-gated pages can be rendered directly. */
const mockAuth = (roles) => {
  vi.doMock('../auth/AuthContext', async (importOriginal) => {
    const actual = await importOriginal();
    return {
      ...actual,
      useAuth: () => ({
        user: { fullName: 'Priya Sharma', email: 'priya@contoso.com', roles },
        isAuthenticated: true, initialising: false, mustChangePassword: false,
        hasRole: (...r) => r.some((x) => roles.includes(x)),
        isAdmin: roles.includes('ADMIN'), isManager: roles.includes('MANAGER'),
        signIn: vi.fn(), signOut: vi.fn(), refreshUser: vi.fn(),
      }),
    };
  });
};

const mount = (ui, route = '/') => render(
  <ThemeProvider theme={theme}>
    <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
  </ThemeProvider>,
);

beforeEach(() => {
  vi.resetModules();
  // Surface a React render error as a test failure rather than a silent console line.
  vi.spyOn(console, 'error').mockImplementation((...args) => { throw new Error(String(args[0])); });
});

/* --------------------------------------------------------------------------- tests */

describe('page render smoke tests', () => {
  it('LoginPage renders the sign-in form', async () => {
    mockAuth([]);
    vi.doMock('../auth/AuthContext', async (importOriginal) => {
      const actual = await importOriginal();
      return {
        ...actual,
        useAuth: () => ({ signIn: vi.fn(), isAuthenticated: false, initialising: false }),
      };
    });

    const { default: LoginPage } = await import('../pages/LoginPage');
    mount(<LoginPage />, '/login');

    expect(screen.getByRole('heading', { name: /welcome back/i })).toBeDefined();
    expect(screen.getByLabelText(/email/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /^sign in$/i })).toBeDefined();
  });

  it('DashboardPage renders the employee view with KPI cards and a chart', async () => {
    mockAuth(['EMPLOYEE']);
    const { default: DashboardPage } = await import('../pages/DashboardPage');
    mount(<DashboardPage />, '/dashboard');

    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeDefined());
    expect(screen.getByText('This week')).toBeDefined();
    expect(screen.getByText('Missing days')).toBeDefined();
    expect(screen.getByText('Hours logged')).toBeDefined();
  });

  it('DashboardPage renders the manager view', async () => {
    mockAuth(['MANAGER']);
    const { default: DashboardPage } = await import('../pages/DashboardPage');
    mount(<DashboardPage />, '/dashboard');

    await waitFor(() => expect(screen.getByText('Team size')).toBeDefined());
    expect(screen.getByText('Avg utilisation')).toBeDefined();
  });

  it('DashboardPage renders the admin view with renamed cards and no Entries card', async () => {
    mockAuth(['ADMIN']);
    const { default: DashboardPage } = await import('../pages/DashboardPage');
    mount(<DashboardPage />, '/dashboard');

    // Renamed: "Active users" -> "Users", "Active projects" -> "Projects".
    await waitFor(() => expect(screen.getByText('Users')).toBeDefined());
    expect(screen.getByText('Projects')).toBeDefined();
    expect(screen.queryByText('Active users')).toBeNull();
    expect(screen.queryByText('Active projects')).toBeNull();

    // Counts still bind to the same fields, so the values must be unchanged.
    expect(screen.getByText('24')).toBeDefined();       // activeUsers
    expect(screen.getByText('/ 30')).toBeDefined();     // totalUsers suffix
    expect(screen.getByText('8')).toBeDefined();        // activeProjects
    expect(screen.getByText('/ 12')).toBeDefined();     // totalProjects suffix

    // "Entries" card commented out.
    expect(screen.queryByText('Entries')).toBeNull();

    expect(screen.getByText('AI adoption')).toBeDefined();
  });

  it('DsrEntryPage renders all three form sections and the saved entries', async () => {
    mockAuth(['EMPLOYEE']);
    const { default: DsrEntryPage } = await import('../pages/DsrEntryPage');
    mount(<DsrEntryPage />, '/dsr');

    await waitFor(() => expect(screen.getByText('When')).toBeDefined());
    expect(screen.getByText('What you worked on')).toBeDefined();
    expect(screen.getByText('AI usage')).toBeDefined();
    expect(screen.getByLabelText(/work description/i)).toBeDefined();
    // The saved-entries panel is driven by the day fixture.
    await waitFor(() => expect(screen.getByText('Project A')).toBeDefined());
  });

  it('DSR Entry no longer offers a No Work Done control', async () => {
    mockAuth(['EMPLOYEE']);
    const { default: DsrEntryPage } = await import('../pages/DsrEntryPage');
    mount(<DsrEntryPage />, '/dsr');

    await waitFor(() => expect(screen.getByText('When')).toBeDefined());

    // The input is gone: no checkbox and no label offering it.
    expect(screen.queryByRole('checkbox', { name: /no work done/i })).toBeNull();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);

    // The form still works — Work Date and the required fields are present.
    expect(screen.getByLabelText(/work date/i)).toBeDefined();
    expect(screen.getByRole('combobox', { name: /project/i })).toBeDefined();
  });

  it('DsrHistoryPage renders filters and rows', async () => {
    mockAuth(['EMPLOYEE']);
    const { default: DsrHistoryPage } = await import('../pages/DsrHistoryPage');
    mount(<DsrHistoryPage />, '/dsr/history');

    await waitFor(() => expect(screen.getByText('Filters')).toBeDefined());
    await waitFor(() => expect(screen.getByText('Built the thing')).toBeDefined());
  });

  it('ReportsPage renders tabs, AI cards and the grid', async () => {
    mockAuth(['ADMIN']);
    const { default: ReportsPage } = await import('../pages/ReportsPage');
    mount(<ReportsPage />, '/reports');

    await waitFor(() => expect(screen.getByRole('tab', { name: 'Employee' })).toBeDefined());

    /*  "AI adoption" legitimately appears twice on this page -- once as the KPI card label and
        once as a column header in the Employee report -- so the assertion targets the card's
        VALUE, which is unique, rather than a label shared by two different elements.  */
    await waitFor(() => expect(screen.getByText('58%')).toBeDefined());
    expect(screen.getAllByText('AI adoption').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('tab', { name: 'Missing DSR' })).toBeDefined();
  });

  it('DsrDetailsPage renders the seven summary cards and the details grid', async () => {
    mockAuth(['ADMIN']);
    const { default: DsrDetailsPage } = await import('../pages/admin/DsrDetailsPage');
    mount(<DsrDetailsPage />, '/admin/dsr-reports');

    await waitFor(() => expect(screen.getByText('Entries')).toBeDefined());

    // Six cards now: "Departments" is commented out as per the current requirement.
    ['Entries', 'Employees', 'Projects', 'Hours logged', 'Estimated', 'AI adoption']
      .forEach((label) => expect(screen.getByText(label)).toBeDefined());
    ['Departments', 'Remaining', 'Pending', 'Approved', 'Returned', 'No work']
      .forEach((label) => expect(screen.queryByText(label)).toBeNull());

    // Category column stays hidden; Project and Task remain.
    expect(screen.queryByRole('columnheader', { name: 'Category' })).toBeNull();
    expect(screen.getByRole('columnheader', { name: 'Project' })).toBeDefined();
  });

  it('DSR Details grid leads with Date and ends with Task Entry Date', async () => {
    mockAuth(['ADMIN']);
    const { default: DsrDetailsPage } = await import('../pages/admin/DsrDetailsPage');
    mount(<DsrDetailsPage />, '/admin/dsr-reports');

    await waitFor(() => expect(screen.getByRole('columnheader', { name: 'Date' })).toBeDefined());

    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent.trim());
    expect(headers).toEqual(['Date', 'Employee', 'Project', 'Task', 'Logged', 'Est.', 'Task Entry Date']);

    // The old trailing "Submitted" column is gone.
    expect(screen.queryByRole('columnheader', { name: 'Submitted' })).toBeNull();

    /*  Date must render the WORK date (2026-08-10 in the fixture), and Task Entry Date the
        recorded-on stamp. The fixture deliberately gives them different values so a mix-up
        between the two cannot pass.  */
    const cells = screen.getAllByRole('cell').map((c) => c.textContent.trim());
    expect(cells[0]).toBe('10 Aug 26');            // Date  <- dsrDate
    expect(cells[cells.length - 1]).toMatch(/^12 Aug 26 /); // Task Entry Date <- taskEntryDate
  });

  it('UsersPage renders the roster', async () => {
    mockAuth(['ADMIN']);
    const { default: UsersPage } = await import('../pages/admin/UsersPage');
    mount(<UsersPage />, '/admin/users');

    await waitFor(() => expect(screen.getByText('priya@contoso.com')).toBeDefined());
    expect(screen.getByRole('button', { name: /add user/i })).toBeDefined();
  });

  it('ProjectsPage renders the project table', async () => {
    mockAuth(['ADMIN']);
    const { default: ProjectsPage } = await import('../pages/admin/ProjectsPage');
    mount(<ProjectsPage />, '/admin/projects');

    await waitFor(() => expect(screen.getByText('Project A')).toBeDefined());
    expect(screen.getByRole('button', { name: /add project/i })).toBeDefined();
  });

  it('SettingsPage renders editable and read-only settings', async () => {
    mockAuth(['ADMIN']);
    const { default: SettingsPage } = await import('../pages/admin/SettingsPage');
    mount(<SettingsPage />, '/admin/settings');

    await waitFor(() => expect(screen.getByText('DSR.MaxDailyHours')).toBeDefined());
    expect(screen.getByLabelText('Value for DSR.Locked')).toBeDefined();
  });

  it('ChangePasswordPage renders the live policy checklist', async () => {
    mockAuth(['EMPLOYEE']);
    const { default: ChangePasswordPage } = await import('../pages/ChangePasswordPage');
    mount(<ChangePasswordPage />, '/change-password');

    expect(screen.getByText('Password must contain')).toBeDefined();
    expect(screen.getByText('At least 12 characters')).toBeDefined();
  });

  it('NotAuthorisedPage renders', async () => {
    const { default: NotAuthorisedPage } = await import('../pages/NotAuthorisedPage');
    mount(<NotAuthorisedPage />, '/not-authorised');

    expect(screen.getByRole('heading', { name: /not authorised/i })).toBeDefined();
  });
});

/**
 * Approval workflow disabled as per current business requirement.
 * All DSR entries are treated as automatically approved.
 *
 * These assert the ABSENCE of the workflow. They are the regression guard: if any approval control
 * is uncommented by accident, or a merge restores one, the suite fails rather than the behaviour
 * quietly returning to production.
 */
describe('approval workflow is disabled', () => {
  it('DSR Reports exposes no approve, return or selection controls', async () => {
    mockAuth(['ADMIN']);
    const { default: DsrDetailsPage } = await import('../pages/admin/DsrDetailsPage');
    mount(<DsrDetailsPage />, '/admin/dsr-reports');

    await waitFor(() => expect(screen.getByText('Entries')).toBeDefined());

    // No action buttons.
    expect(screen.queryByRole('button', { name: /^approve$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^return$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /reject|send back/i })).toBeNull();

    // No row-selection checkboxes at all (they existed only to drive bulk approve/return).
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);

    // No Approval Status tab.
    expect(screen.queryByRole('tab', { name: /approval status/i })).toBeNull();

    // Detail grid carries no approval columns.
    ['Status', 'Approved By', 'Pending', 'Approved', 'Returned']
      .forEach((h) => expect(screen.queryByRole('columnheader', { name: h })).toBeNull());
  });

  it('grouped tabs show no Pending/Approved/Returned columns', async () => {
    mockAuth(['ADMIN']);
    const { adminReportsApi } = await import('../api/client');
    const { default: DsrDetailsPage } = await import('../pages/admin/DsrDetailsPage');

    // The grouped payload still carries the approval counts; the UI must simply not render them.
    mount(<DsrDetailsPage />, '/admin/dsr-reports');
    await waitFor(() => expect(adminReportsApi.dsrDetails).toHaveBeenCalled());

    ['Pending', 'Approved', 'Returned']
      .forEach((h) => expect(screen.queryByRole('columnheader', { name: h })).toBeNull());
  });

  it('the real api client exposes no review or approvalStatus call', async () => {
    /*  importActual, NOT import: this file mocks ../api/client, so a plain import would assert
        against the mock and prove nothing about shipped code. This reads the real module.  */
    const { adminReportsApi } = await vi.importActual('../api/client');

    expect(adminReportsApi.review).toBeUndefined();
    expect(adminReportsApi.approvalStatus).toBeUndefined();

    // The surviving report calls must still be intact.
    ['dsrDetails', 'grouped', 'noWorkDone', 'missingDsr', 'exportReport']
      .forEach((fn) => expect(typeof adminReportsApi[fn]).toBe('function'));
  });
});

/**
 * DAILY HOURS LIMITS REMOVED as per current business requirement.
 * 8 hours is the utilisation benchmark only; it must not restrict entry.
 */
describe('daily hours limits are removed', () => {
  it('the hours field carries no 8-hour or "remaining" messaging', async () => {
    mockAuth(['EMPLOYEE']);
    const { default: DsrEntryPage } = await import('../pages/DsrEntryPage');
    mount(<DsrEntryPage />, '/dsr');

    await waitFor(() => expect(screen.getByLabelText(/estimated hours/i)).toBeDefined());

    const body = document.body.textContent;

    /*  Match the RESTRICTIVE phrasings only. An earlier version of this test rejected any
        occurrence of "daily limit" and failed against the field's own helper text -- "There is no
        daily limit." -- which is the opposite of a restriction. The patterns below cannot match a
        negation of themselves.  */
    expect(body).not.toMatch(/remaining for this project/i);
    expect(body).not.toMatch(/cannot exceed 8|maximum 8 hours|daily limit reached/i);
    expect(body).not.toMatch(/up to 8 hour/i);

    // And the field states the new rule positively.
    expect(body).toMatch(/no daily limit/i);

    // The field must not cap input at the benchmark.
    const hours = screen.getByLabelText(/estimated hours/i);
    expect(Number(hours.getAttribute('max'))).toBeGreaterThan(8);
  });

  it('day utilisation is reported uncapped against the 8-hour benchmark', async () => {
    /*  The day fixture totals 6h against an 8h benchmark = 75%, matching the requirement's
        Case 4. The assertion is on the benchmark WORDING plus the uncapped percentage, which is
        what the old Math.min(100, ...) clamp would have hidden.  */
    mockAuth(['EMPLOYEE']);
    const { default: DsrEntryPage } = await import('../pages/DsrEntryPage');
    mount(<DsrEntryPage />, '/dsr');

    await waitFor(() => expect(screen.getByText(/of the 8h benchmark/i)).toBeDefined());
    expect(screen.getByText(/^75% of the 8h benchmark/)).toBeDefined();
  });
});

/**
 * Project dropdown shows the project NAME ONLY -- no "(Active)" suffix, no code, no status chip.
 */
describe('project dropdown displays only the project name', () => {
  it('lists bare project names on the DSR entry screen', async () => {
    mockAuth(['EMPLOYEE']);
    const { default: DsrEntryPage } = await import('../pages/DsrEntryPage');
    const { default: userEventDefault } = await import('@testing-library/user-event');
    const user = userEventDefault.setup();

    mount(<DsrEntryPage />, '/dsr');
    await waitFor(() => expect(screen.getByText('What you worked on')).toBeDefined());

    // Open the searchable dropdown.
    await user.click(screen.getByRole('combobox', { name: /project/i }));

    const options = await screen.findAllByRole('option');
    const labels = options.map((o) => o.textContent.trim());

    expect(labels).toEqual(['Project A', 'Project B']);

    // Specifically: no status suffix and no project code anywhere in the list.
    labels.forEach((l) => {
      expect(l).not.toMatch(/active|completed|planned|on_hold|cancelled/i);
      expect(l).not.toMatch(/PRJ-/);
    });
  });

  it('still finds a project by its code even though the code is not shown', async () => {
    mockAuth(['EMPLOYEE']);
    const { default: DsrEntryPage } = await import('../pages/DsrEntryPage');
    const { default: userEventDefault } = await import('@testing-library/user-event');
    const user = userEventDefault.setup();

    mount(<DsrEntryPage />, '/dsr');
    await waitFor(() => expect(screen.getByText('What you worked on')).toBeDefined());

    await user.type(screen.getByRole('combobox', { name: /project/i }), 'PRJ-B');

    const options = await screen.findAllByRole('option');
    expect(options.map((o) => o.textContent.trim())).toEqual(['Project B']);
  });
});
