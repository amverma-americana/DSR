using System.Linq.Expressions;
using DSR.Application.Interfaces;
using DSR.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace DSR.Infrastructure.Persistence;

/// <summary>
/// Generic repository. <see cref="Query"/> returns a no-tracking queryable for reads so projections
/// stay cheap; <see cref="QueryForUpdate"/> returns a tracked one for entities about to be mutated.
/// Exposing IQueryable keeps report composition in the service layer instead of growing a method
/// per query here.
/// </summary>
public class Repository<T>(DsrDbContext context) : IRepository<T> where T : class
{
    private readonly DbSet<T> _set = context.Set<T>();

    public IQueryable<T> Query() => _set.AsNoTracking();
    public IQueryable<T> QueryForUpdate() => _set;

    public async Task<T?> GetByIdAsync(object id, CancellationToken ct = default) => await _set.FindAsync([id], ct);

    public Task<T?> FirstOrDefaultAsync(Expression<Func<T, bool>> predicate, CancellationToken ct = default) =>
        _set.AsNoTracking().FirstOrDefaultAsync(predicate, ct);

    public Task<bool> AnyAsync(Expression<Func<T, bool>> predicate, CancellationToken ct = default) =>
        _set.AsNoTracking().AnyAsync(predicate, ct);

    public Task<int> CountAsync(Expression<Func<T, bool>>? predicate = null, CancellationToken ct = default) =>
        predicate is null ? _set.AsNoTracking().CountAsync(ct) : _set.AsNoTracking().CountAsync(predicate, ct);

    public async Task AddAsync(T entity, CancellationToken ct = default) => await _set.AddAsync(entity, ct);

    public async Task AddRangeAsync(IEnumerable<T> entities, CancellationToken ct = default) =>
        await _set.AddRangeAsync(entities, ct);

    public void Update(T entity) => _set.Update(entity);
    public void Remove(T entity) => _set.Remove(entity);
}

/// <summary>
/// Unit of work over one DbContext instance. A single SaveChangesAsync commits a DSR entry and its
/// day-level AI declaration together, so the two can never diverge.
/// </summary>
public class UnitOfWork(DsrDbContext context) : IUnitOfWork
{
    private IDbContextTransaction? _transaction;

    public IRepository<User> Users { get; } = new Repository<User>(context);
    public IRepository<Role> Roles { get; } = new Repository<Role>(context);
    public IRepository<UserRole> UserRoles { get; } = new Repository<UserRole>(context);
    public IRepository<UserCredential> UserCredentials { get; } = new Repository<UserCredential>(context);
    public IRepository<UserLoginAudit> LoginAudits { get; } = new Repository<UserLoginAudit>(context);
    public IRepository<RefreshToken> RefreshTokens { get; } = new Repository<RefreshToken>(context);
    public IRepository<SsoRoleMapping> SsoRoleMappings { get; } = new Repository<SsoRoleMapping>(context);
    public IRepository<Project> Projects { get; } = new Repository<Project>(context);
    public IRepository<ProjectAllocation> ProjectAllocations { get; } = new Repository<ProjectAllocation>(context);
    public IRepository<AiTool> AiTools { get; } = new Repository<AiTool>(context);
    public IRepository<Holiday> Holidays { get; } = new Repository<Holiday>(context);
    public IRepository<AppSetting> AppSettings { get; } = new Repository<AppSetting>(context);
    public IRepository<DsrEntry> DsrEntries { get; } = new Repository<DsrEntry>(context);
    public IRepository<DailyAiUsage> DailyAiUsages { get; } = new Repository<DailyAiUsage>(context);
    public IRepository<AuditLog> AuditLogs { get; } = new Repository<AuditLog>(context);
    public IRepository<Department> Departments { get; } = new Repository<Department>(context);
    public IRepository<WorkCategory> WorkCategories { get; } = new Repository<WorkCategory>(context);

    public Task<int> SaveChangesAsync(CancellationToken ct = default) => context.SaveChangesAsync(ct);

    public async Task<IAsyncDisposable> BeginTransactionAsync(CancellationToken ct = default)
    {
        _transaction = await context.Database.BeginTransactionAsync(ct);
        return _transaction;
    }

    public async Task CommitAsync(CancellationToken ct = default)
    {
        if (_transaction is not null) await _transaction.CommitAsync(ct);
    }

    public async Task RollbackAsync(CancellationToken ct = default)
    {
        if (_transaction is not null) await _transaction.RollbackAsync(ct);
    }

    public async ValueTask DisposeAsync()
    {
        if (_transaction is not null) await _transaction.DisposeAsync();
        GC.SuppressFinalize(this);
    }
}

/// <summary>
/// Read-only access to the reporting views and table-valued functions.
/// The two TVFs are invoked with FromSqlInterpolated, which parameterises the arguments -- string
/// concatenation here would be a SQL injection hole on a date filter.
/// </summary>
public class ReportingRepository(DsrDbContext context) : IReportingRepository
{
    public IQueryable<DsrEntryDetailView> DsrEntryDetail => context.DsrEntryDetail.AsNoTracking();
    public IQueryable<DsrDailySummaryView> DailySummary => context.DsrDailySummary.AsNoTracking();
    public IQueryable<DsrMonthlySummaryView> MonthlySummary => context.DsrMonthlySummary.AsNoTracking();
    public IQueryable<ProjectEffortSummaryView> ProjectEffort => context.ProjectEffortSummary.AsNoTracking();
    public IQueryable<AiAdoptionDailyView> AiAdoptionDaily => context.AiAdoptionDaily.AsNoTracking();


    public IQueryable<ResourceUtilizationView> GetResourceUtilization(DateOnly fromDate, DateOnly toDate) =>
        context.ResourceUtilization
            .FromSqlInterpolated($"SELECT * FROM dsr.fn_GetResourceUtilization({fromDate}, {toDate})")
            .AsNoTracking();
}

/// <summary>
/// Read-only access to the Admin reporting spine. Kept separate from IReportingRepository because
/// it serves a different consumer (the Admin detail module) over a wider view.
/// </summary>
public class DetailReportRepository(DsrDbContext context) : IDetailReportRepository
{
    public IQueryable<DsrDetailReportView> DsrDetailReport => context.DsrDetailReport.AsNoTracking();

    public IQueryable<MissingDsrDetailView> GetMissingDsrDetail(DateOnly fromDate, DateOnly toDate, int? managerUserId, int? departmentId) =>
        context.MissingDsrDetail
            .FromSqlInterpolated($"SELECT * FROM dsr.fn_GetMissingDsrDays({fromDate}, {toDate}, {managerUserId}, {departmentId})")
            .AsNoTracking();
}
