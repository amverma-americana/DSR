import axios from 'axios';

/**
 * Single axios instance for the whole app.
 *
 * Token strategy: the access token lives in memory only, never in localStorage, so an XSS payload
 * cannot read it. The refresh token is persisted in sessionStorage so a page reload keeps the user
 * signed in for the tab's lifetime; it is rotated on every use and the server revokes the whole
 * token family if an old one is replayed.
 */
const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
  headers: { 'Content-Type': 'application/json' },
  timeout: 30000,
});

const REFRESH_KEY = 'dsr.refreshToken';

let accessToken = null;
let onSessionExpired = null;

export const tokenStore = {
  setAccessToken: (t) => { accessToken = t; },
  getAccessToken: () => accessToken,
  setRefreshToken: (t) => (t ? sessionStorage.setItem(REFRESH_KEY, t) : sessionStorage.removeItem(REFRESH_KEY)),
  getRefreshToken: () => sessionStorage.getItem(REFRESH_KEY),
  clear: () => { accessToken = null; sessionStorage.removeItem(REFRESH_KEY); },
  onSessionExpired: (handler) => { onSessionExpired = handler; },
};

api.interceptors.request.use((config) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});

/* Single-flight refresh: concurrent 401s queue behind one refresh call instead of firing N. */
let refreshing = null;

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const { response, config } = error;

    if (response?.status === 401 && !config._retried && tokenStore.getRefreshToken()) {
      config._retried = true;

      refreshing ??= api
        .post('/auth/refresh', { refreshToken: tokenStore.getRefreshToken() })
        .then(({ data }) => {
          tokenStore.setAccessToken(data.data.accessToken);
          tokenStore.setRefreshToken(data.data.refreshToken);
          return data.data.accessToken;
        })
        .catch((refreshError) => {
          tokenStore.clear();
          onSessionExpired?.();
          throw refreshError;
        })
        .finally(() => { refreshing = null; });

      try {
        const newToken = await refreshing;
        config.headers.Authorization = `Bearer ${newToken}`;
        return api.request(config);
      } catch {
        return Promise.reject(error);
      }
    }

    return Promise.reject(normalizeError(error));
  },
);

/**
 * Flattens the ApiResponse envelope into a predictable shape so every screen handles errors the
 * same way, whether they came from FluentValidation, a service rule or a database constraint.
 */
function normalizeError(error) {
  const payload = error.response?.data;
  const normalized = new Error(payload?.message || error.message || 'The request failed.');
  normalized.status = error.response?.status;
  normalized.fieldErrors = payload?.errors || null;
  normalized.traceId = payload?.traceId;
  return normalized;
}

/** Unwraps ApiResponse.data so callers work with the payload directly. */
const unwrap = (promise) => promise.then(({ data }) => data.data);

export const authApi = {
  login: (email, password) => unwrap(api.post('/auth/login', { email, password })),
  ssoLogin: (idToken) => unwrap(api.post('/auth/sso-login', { idToken })),
  me: () => unwrap(api.get('/auth/me')),
  logout: (refreshToken) => api.post('/auth/logout', { refreshToken }),
  changePassword: (currentPassword, newPassword) =>
    unwrap(api.post('/auth/change-password', { currentPassword, newPassword })),
  resetPassword: (userId) => unwrap(api.post('/auth/reset-password', { userId })),
};

export const dsrApi = {
  /**
   * The project list depends on the work date (a project only accepts effort inside its own
   * start/end window), so always pass the date currently selected on the form.
   */
  metadata: (workDate) => unwrap(api.get('/dsr/metadata', { params: { workDate } })),
  day: (workDate, userId) => unwrap(api.get(`/dsr/day/${workDate}`, { params: { userId } })),
  search: (filter) => unwrap(api.get('/dsr', { params: filter })),
  create: (payload) => unwrap(api.post('/dsr', payload)),
  update: (id, payload) => unwrap(api.put(`/dsr/${id}`, payload)),
  remove: (id) => unwrap(api.delete(`/dsr/${id}`)),
};

export const dashboardApi = {
  employee: () => unwrap(api.get('/dashboard/employee')),
  manager: (filter) => unwrap(api.get('/dashboard/manager', { params: filter })),
  admin: () => unwrap(api.get('/dashboard/admin')),
};

export const reportsApi = {
  employee: (f) => unwrap(api.get('/reports/employee', { params: f })),
  project: (f) => unwrap(api.get('/reports/project', { params: f })),
  utilization: (f) => unwrap(api.get('/reports/resource-utilization', { params: f })),
  aiUsage: (f) => unwrap(api.get('/reports/ai-usage', { params: f })),
  dailySummary: (f) => unwrap(api.get('/reports/daily-summary', { params: f })),
  monthlySummary: (f) => unwrap(api.get('/reports/monthly-summary', { params: f })),
  missingDsr: (f) => unwrap(api.get('/reports/missing-dsr', { params: f })),
  exportCsv: async (reportKey, filter) => {
    const response = await api.get(`/reports/export/${reportKey}`, { params: filter, responseType: 'blob' });
    const url = URL.createObjectURL(response.data);
    const link = document.createElement('a');
    link.href = url;
    link.download = /filename=([^;]+)/.exec(response.headers['content-disposition'])?.[1] || `${reportKey}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  },
};

/**
 * Admin reporting module. Every endpoint takes the SAME filter object, so switching report tabs
 * re-slices one population rather than showing differently-filtered data.
 */
export const adminReportsApi = {
  dsrDetails: (f) => unwrap(api.get('/admin-reports/dsr-details', { params: f })),
  grouped: (groupBy, f) => unwrap(api.get(`/admin-reports/grouped/${groupBy}`, { params: f })),
  approvalStatus: (f) => unwrap(api.get('/admin-reports/approval-status', { params: f })),
  noWorkDone: (f) => unwrap(api.get('/admin-reports/no-work-done', { params: f })),
  missingDsr: (f) => unwrap(api.get('/admin-reports/missing-dsr', { params: f })),
  review: (payload) => unwrap(api.post('/admin-reports/review', payload)),
  exportReport: async (format, filter) => {
    const response = await api.get(`/admin-reports/export/${format}`, { params: filter, responseType: 'blob' });
    const url = URL.createObjectURL(response.data);
    const link = document.createElement('a');
    link.href = url;
    link.download = /filename=([^;]+)/.exec(response.headers['content-disposition'])?.[1] || `dsr-report.${format}`;
    link.click();
    URL.revokeObjectURL(url);
  },
};

export const usersApi = {
  search: (f) => unwrap(api.get('/users', { params: f })),
  byId: (id) => unwrap(api.get(`/users/${id}`)),
  team: (managerUserId) => unwrap(api.get('/users/team', { params: { managerUserId } })),
  managers: () => unwrap(api.get('/users/managers')),
  create: (p) => unwrap(api.post('/users', p)),
  update: (id, p) => unwrap(api.put(`/users/${id}`, p)),
  setActive: (id, isActive) => unwrap(api.patch(`/users/${id}/active`, null, { params: { isActive } })),
};

export const projectsApi = {
  search: (f) => unwrap(api.get('/projects', { params: f })),
  byId: (id) => unwrap(api.get(`/projects/${id}`)),
  create: (p) => unwrap(api.post('/projects', p)),
  update: (id, p) => unwrap(api.put(`/projects/${id}`, p)),
  setActive: (id, isActive) => unwrap(api.patch(`/projects/${id}/active`, null, { params: { isActive } })),
  allocations: (projectId, userId) => unwrap(api.get('/projects/allocations', { params: { projectId, userId } })),
  saveAllocation: (p) => unwrap(api.post('/projects/allocations', p)),
  removeAllocation: (id) => unwrap(api.delete(`/projects/allocations/${id}`)),
};

export const mastersApi = {
  roles: () => unwrap(api.get('/masters/roles')),
  aiTools: () => unwrap(api.get('/masters/ai-tools')),
  holidays: (year) => unwrap(api.get('/masters/holidays', { params: { year } })),
  settings: () => unwrap(api.get('/masters/settings')),
  departments: () => unwrap(api.get('/masters/departments')),
  workCategories: () => unwrap(api.get('/masters/work-categories')),
  updateSetting: (key, value) => unwrap(api.put(`/masters/settings/${key}`, JSON.stringify(value))),
};

export default api;
