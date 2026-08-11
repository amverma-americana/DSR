using System.Linq.Expressions;
using DSR.Domain.Common;
using DSR.Domain.Entities;

namespace DSR.Application.Interfaces;

/// <summary>
/// Generic repository over the aggregate roots. Deliberately exposes IQueryable via
/// <see cref="Query"/> so services can compose paging, filtering and projection without this
/// interface growing a method per report -- the classic repository anti-pattern.
/// Nothing outside Infrastructure sees DbContext.
/// </summary>
public interface IRepository<T> where T : class
{
    /// <summary>No-tracking queryable for reads and projections.</summary>
    IQueryable<T> Query();

    /// <summary>Tracking queryable, for entities that will be mutated in this unit of work.</summary>
    IQueryable<T> QueryForUpdate();

    Task<T?> GetByIdAsync(object id, CancellationToken ct = default);
    Task<T?> FirstOrDefaultAsync(Expression<Func<T, bool>> predicate, CancellationToken ct = default);
    Task<bool> AnyAsync(Expression<Func<T, bool>> predicate, CancellationToken ct = default);
    Task<int> CountAsync(Expression<Func<T, bool>>? predicate = null, CancellationToken ct = default);
    Task AddAsync(T entity, CancellationToken ct = default);
    Task AddRangeAsync(IEnumerable<T> entities, CancellationToken ct = default);
    void Update(T entity);
    void Remove(T entity);
}

/// <summary>
/// Unit of work. One SaveChangesAsync per request, so a DSR entry and its day-level AI declaration
/// commit atomically -- an entry can never be saved without its AI answer, or vice versa.
/// </summary>
public interface IUnitOfWork : IAsyncDisposable
{
    IRepository<User> Users { get; }
    IRepository<Role> Roles { get; }
    IRepository<UserRole> UserRoles { get; }
    IRepository<UserCredential> UserCredentials { get; }
    IRepository<UserLoginAudit> LoginAudits { get; }
    IRepository<RefreshToken> RefreshTokens { get; }
    IRepository<SsoRoleMapping> SsoRoleMappings { get; }
    IRepository<Project> Projects { get; }
    IRepository<ProjectAllocation> ProjectAllocations { get; }
    IRepository<AiTool> AiTools { get; }
    IRepository<Holiday> Holidays { get; }
    IRepository<AppSetting> AppSettings { get; }
    IRepository<DsrEntry> DsrEntries { get; }
    IRepository<DailyAiUsage> DailyAiUsages { get; }
    IRepository<AuditLog> AuditLogs { get; }
    IRepository<Department> Departments { get; }
    IRepository<WorkCategory> WorkCategories { get; }

    Task<int> SaveChangesAsync(CancellationToken ct = default);

    /// <summary>Explicit transaction for multi-step operations that must not partially apply.</summary>
    Task<IAsyncDisposable> BeginTransactionAsync(CancellationToken ct = default);
    Task CommitAsync(CancellationToken ct = default);
    Task RollbackAsync(CancellationToken ct = default);
}

/// <summary>
/// Read-only access to the reporting views and table-valued functions. Separate from
/// <see cref="IUnitOfWork"/> because these are projections, never written to, and several are
/// keyless -- mixing them into the write model invites accidental tracking.
/// </summary>
public interface IReportingRepository
{
    IQueryable<DsrEntryDetailView> DsrEntryDetail { get; }
    IQueryable<DsrDailySummaryView> DailySummary { get; }
    IQueryable<DsrMonthlySummaryView> MonthlySummary { get; }
    IQueryable<ProjectEffortSummaryView> ProjectEffort { get; }
    IQueryable<AiAdoptionDailyView> AiAdoptionDaily { get; }

    /*  There is deliberately NO GetMissingDsrDays here any more.
        Two repository methods used to wrap the same SQL function with different arities; when
        fn_GetMissingDsrDays gained a @DepartmentId parameter the 3-argument caller broke at
        runtime with "An insufficient number of arguments were supplied". SQL Server table-valued
        functions do not allow omitted arguments, so the duplication was a standing trap.
        The single wrapper now lives on IDetailReportRepository.GetMissingDsrDetail.            */

    /// <summary>Maps dsr.fn_GetResourceUtilization.</summary>
    IQueryable<ResourceUtilizationView> GetResourceUtilization(DateOnly fromDate, DateOnly toDate);
}

/// <summary>Read-only access to the Admin reporting spine and the enriched Missing-DSR function.</summary>
public interface IDetailReportRepository
{
    IQueryable<DsrDetailReportView> DsrDetailReport { get; }

    /// <summary>dsr.fn_GetMissingDsrDays -- now returns manager and department too.</summary>
    IQueryable<MissingDsrDetailView> GetMissingDsrDetail(DateOnly fromDate, DateOnly toDate, int? managerUserId, int? departmentId);
}
