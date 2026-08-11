using DSR.Application.Common;
using DSR.Domain.Common;
using DSR.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace DSR.Infrastructure.Persistence;

/// <summary>
/// Maps the EXISTING DSRResourceManagement schema. The database is the source of truth: this
/// context is configured to match it exactly and no EF migrations are generated against it, so the
/// hand-written SQL scripts remain authoritative (see docs/DEPLOYMENT.md).
///
/// Two behaviours are centralised here rather than left to services:
///   1. Audit columns are stamped in SaveChangesAsync from ICurrentUser, so attribution cannot be
///      forgotten or spoofed by a caller.
///   2. Global query filters exclude soft-deleted rows, so no query can accidentally include them.
/// </summary>
public class DsrDbContext(DbContextOptions<DsrDbContext> options, ICurrentUser currentUser, IDateTimeProvider clock)
    : DbContext(options)
{
    public const string Schema = "dsr";

    // ---- write model -------------------------------------------------------------------------
    public DbSet<User> Users => Set<User>();
    public DbSet<Role> Roles => Set<Role>();
    public DbSet<UserRole> UserRoles => Set<UserRole>();
    public DbSet<UserCredential> UserCredentials => Set<UserCredential>();
    public DbSet<UserLoginAudit> UserLoginAudits => Set<UserLoginAudit>();
    public DbSet<RefreshToken> RefreshTokens => Set<RefreshToken>();
    public DbSet<SsoRoleMapping> SsoRoleMappings => Set<SsoRoleMapping>();
    public DbSet<Project> Projects => Set<Project>();
    public DbSet<ProjectAllocation> ProjectAllocations => Set<ProjectAllocation>();
    public DbSet<AiTool> AiTools => Set<AiTool>();
    public DbSet<Holiday> Holidays => Set<Holiday>();
    public DbSet<AppSetting> AppSettings => Set<AppSetting>();
    public DbSet<DsrEntry> DsrEntries => Set<DsrEntry>();
    public DbSet<DailyAiUsage> DailyAiUsages => Set<DailyAiUsage>();
    public DbSet<AuditLog> AuditLogs => Set<AuditLog>();
    public DbSet<Department> Departments => Set<Department>();
    public DbSet<WorkCategory> WorkCategories => Set<WorkCategory>();

    // ---- read model (views and table-valued functions) ---------------------------------------
    public DbSet<DsrEntryDetailView> DsrEntryDetail => Set<DsrEntryDetailView>();
    public DbSet<DsrDailySummaryView> DsrDailySummary => Set<DsrDailySummaryView>();
    public DbSet<DsrMonthlySummaryView> DsrMonthlySummary => Set<DsrMonthlySummaryView>();
    public DbSet<ProjectEffortSummaryView> ProjectEffortSummary => Set<ProjectEffortSummaryView>();
    public DbSet<AiAdoptionDailyView> AiAdoptionDaily => Set<AiAdoptionDailyView>();
    public DbSet<ResourceUtilizationView> ResourceUtilization => Set<ResourceUtilizationView>();
    public DbSet<DsrDetailReportView> DsrDetailReport => Set<DsrDetailReportView>();
    public DbSet<MissingDsrDetailView> MissingDsrDetail => Set<MissingDsrDetailView>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.HasDefaultSchema(Schema);

        /* --------------------------------- Users ------------------------------------------ */
        b.Entity<User>(e =>
        {
            e.ToTable("Users");
            e.Property(x => x.EmployeeCode).HasMaxLength(30);
            e.Property(x => x.FirstName).HasMaxLength(100).IsRequired();
            e.Property(x => x.LastName).HasMaxLength(100).IsRequired();
            e.Property(x => x.Email).HasMaxLength(256).IsRequired();
            e.Property(x => x.AuthenticationType).HasMaxLength(20).IsRequired();
            e.Property(x => x.ExternalObjectId).HasMaxLength(100);
            e.Property(x => x.ExternalTenantId).HasMaxLength(100);
            e.Property(x => x.Designation).HasMaxLength(100);
            e.Property(x => x.StandardDailyHours).HasColumnType("decimal(4,2)");

            // Persisted computed column: read from the database, never written.
            e.Property(x => x.FullName).HasMaxLength(201)
                .HasComputedColumnSql("(ltrim(rtrim([FirstName]+' '+[LastName])))", stored: true)
                .ValueGeneratedOnAddOrUpdate();

            e.HasOne(x => x.Department).WithMany(x => x.Members).HasForeignKey(x => x.DepartmentId).OnDelete(DeleteBehavior.NoAction);
            e.HasOne(x => x.Manager).WithMany(x => x.DirectReports)
                .HasForeignKey(x => x.ManagerUserId).OnDelete(DeleteBehavior.NoAction);

            e.HasOne(x => x.Credential).WithOne(x => x.User)
                .HasForeignKey<UserCredential>(x => x.UserId).OnDelete(DeleteBehavior.NoAction);
        });

        b.Entity<Role>(e =>
        {
            e.ToTable("Roles");
            e.Property(x => x.RoleCode).HasMaxLength(30).IsRequired();
            e.Property(x => x.RoleName).HasMaxLength(50).IsRequired();
            e.Property(x => x.Description).HasMaxLength(250);
        });

        b.Entity<UserRole>(e =>
        {
            e.ToTable("UserRoles");
            e.HasOne(x => x.User).WithMany(x => x.UserRoles).HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.NoAction);
            e.HasOne(x => x.Role).WithMany(x => x.UserRoles).HasForeignKey(x => x.RoleId).OnDelete(DeleteBehavior.NoAction);
        });

        b.Entity<UserCredential>(e =>
        {
            e.ToTable("UserCredentials");
            e.Property(x => x.PasswordHash).HasMaxLength(500).IsRequired();
            e.Property(x => x.SecurityStamp).IsRequired();
        });

        b.Entity<UserLoginAudit>(e =>
        {
            // Append-only, protected by an INSTEAD OF trigger -> declare it (see DsrEntry note).
            e.ToTable("UserLoginAudit", tb => tb.HasTrigger("trg_UserLoginAudit_PreventChange"));
            e.Property(x => x.AttemptedEmail).HasMaxLength(256).IsRequired();
            e.Property(x => x.AuthenticationType).HasMaxLength(20).IsRequired();
            e.Property(x => x.FailureReason).HasMaxLength(200);
            e.Property(x => x.IpAddress).HasMaxLength(45);
            e.Property(x => x.UserAgent).HasMaxLength(400);
            e.HasOne(x => x.User).WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.NoAction);
        });

        b.Entity<RefreshToken>(e =>
        {
            e.ToTable("RefreshTokens");
            e.Property(x => x.TokenHash).HasColumnType("varbinary(32)").IsRequired();
            e.Property(x => x.JwtId).HasMaxLength(64);
            e.Property(x => x.CreatedByIp).HasMaxLength(45);
            e.Property(x => x.RevokedByIp).HasMaxLength(45);
            e.Property(x => x.RevokedReason).HasMaxLength(200);
            e.HasIndex(x => x.TokenHash).IsUnique();
            e.HasOne(x => x.User).WithMany(x => x.RefreshTokens).HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.NoAction);
            e.HasOne(x => x.ReplacedByToken).WithMany().HasForeignKey(x => x.ReplacedByTokenId).OnDelete(DeleteBehavior.NoAction);
        });

        b.Entity<SsoRoleMapping>(e =>
        {
            e.ToTable("SsoRoleMappings");
            e.Property(x => x.ExternalGroupId).HasMaxLength(100).IsRequired();
            e.Property(x => x.ExternalGroupName).HasMaxLength(200);
            e.HasOne(x => x.Role).WithMany(x => x.SsoRoleMappings).HasForeignKey(x => x.RoleId).OnDelete(DeleteBehavior.NoAction);
        });

        /* --------------------------------- Master ----------------------------------------- */
        b.Entity<Project>(e =>
        {
            e.ToTable("Projects");
            e.Property(x => x.ProjectCode).HasMaxLength(30).IsRequired();
            e.Property(x => x.ProjectName).HasMaxLength(200).IsRequired();
            e.Property(x => x.Description).HasMaxLength(1000);
            e.Property(x => x.Status).HasMaxLength(20).IsRequired();
            e.HasOne(x => x.ProjectManager).WithMany().HasForeignKey(x => x.ProjectManagerUserId).OnDelete(DeleteBehavior.NoAction);
        });

        b.Entity<ProjectAllocation>(e =>
        {
            e.ToTable("ProjectAllocations");
            e.Property(x => x.AllocationPercentage).HasColumnType("decimal(5,2)");
            e.Property(x => x.ProjectRole).HasMaxLength(100);
            e.HasOne(x => x.Project).WithMany(x => x.Allocations).HasForeignKey(x => x.ProjectId).OnDelete(DeleteBehavior.NoAction);
            e.HasOne(x => x.User).WithMany(x => x.ProjectAllocations).HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.NoAction);
        });

        b.Entity<AiTool>(e =>
        {
            e.ToTable("AiTools");
            e.Property(x => x.ToolName).HasMaxLength(100).IsRequired();
            e.Property(x => x.Vendor).HasMaxLength(100);
            e.Property(x => x.Category).HasMaxLength(30);
        });

        b.Entity<Holiday>(e =>
        {
            e.ToTable("Holidays");
            e.Property(x => x.HolidayName).HasMaxLength(100).IsRequired();
        });

        b.Entity<AppSetting>(e =>
        {
            e.ToTable("AppSettings");
            e.Property(x => x.SettingKey).HasMaxLength(100).IsRequired();
            e.Property(x => x.SettingValue).HasMaxLength(500).IsRequired();
            e.Property(x => x.DataType).HasMaxLength(20).IsRequired();
            e.Property(x => x.Description).HasMaxLength(300);
            e.HasIndex(x => x.SettingKey).IsUnique();
        });

        /* ------------------------------ Transactional ------------------------------------- */
        b.Entity<DsrEntry>(e =>
        {
            /*  HasTrigger is REQUIRED, not decorative. From EF Core 7 the SQL Server provider uses
                an OUTPUT clause to read back generated values, and SQL Server rejects that on any
                table carrying a trigger (error 334). Declaring the triggers makes EF fall back to
                SELECT SCOPE_IDENTITY(). dsr.DSREntries has two triggers enforcing the daily hour
                cap and the project window, so without this every INSERT fails.                  */
            e.ToTable("DSREntries", tb =>
            {
                tb.HasTrigger("trg_DSREntries_DailyRules");
                tb.HasTrigger("trg_DSREntries_ProjectWindow");
            });
            e.Property(x => x.EstimatedHours).HasColumnType("decimal(4,2)");
            e.HasOne(x => x.User).WithMany(x => x.DsrEntries).HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.NoAction);
            e.HasOne(x => x.Project).WithMany(x => x.DsrEntries).HasForeignKey(x => x.ProjectId).OnDelete(DeleteBehavior.NoAction);
            e.HasOne(x => x.ApprovedByUser).WithMany().HasForeignKey(x => x.ApprovedByUserId).OnDelete(DeleteBehavior.NoAction);
            e.HasOne(x => x.WorkCategory).WithMany(x => x.DsrEntries).HasForeignKey(x => x.WorkCategoryId).OnDelete(DeleteBehavior.NoAction);
            e.Property(x => x.StatusCode).HasMaxLength(20).IsRequired();
            e.Property(x => x.ReviewComments).HasMaxLength(1000);
            e.Property(x => x.ActualHours).HasColumnType("decimal(4,2)");
            // Computed in SQL; read only, never written by EF.
            e.Property(x => x.RemainingHours).HasColumnType("decimal(5,2)")
                .HasComputedColumnSql("([EstimatedHours] - isnull([ActualHours],(0)))", stored: true)
                .ValueGeneratedOnAddOrUpdate();

            /*  NON-unique by design (migration 06). An employee may log any number of entries
                against the same project on the same date; the only limit on the day is their
                Users.StandardDailyHours, enforced in DsrEntryService and by
                trg_DSREntries_DailyRules. Do not restore IsUnique() here without also restoring
                the database index, or EF will believe an invariant the database no longer holds. */
            e.HasIndex(x => new { x.UserId, x.WorkDate, x.ProjectId })
                .HasFilter("[IsActive] = 1")
                .HasDatabaseName("IX_DSREntries_User_Date_Project");
        });

        b.Entity<Department>(e =>
        {
            e.ToTable("Departments");
            e.Property(x => x.DepartmentCode).HasMaxLength(30).IsRequired();
            e.Property(x => x.DepartmentName).HasMaxLength(100).IsRequired();
            e.HasOne(x => x.Head).WithMany().HasForeignKey(x => x.HeadUserId).OnDelete(DeleteBehavior.NoAction);
        });

        b.Entity<WorkCategory>(e =>
        {
            e.ToTable("WorkCategories");
            e.Property(x => x.CategoryCode).HasMaxLength(30).IsRequired();
            e.Property(x => x.CategoryName).HasMaxLength(100).IsRequired();
        });

        b.Entity<DailyAiUsage>(e =>
        {
            e.ToTable("DailyAiUsage");
            e.Property(x => x.UsageRemarks).HasMaxLength(1000);
            e.HasOne(x => x.User).WithMany(x => x.DailyAiUsages).HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.NoAction);
            e.HasOne(x => x.AiTool).WithMany(x => x.DailyAiUsages).HasForeignKey(x => x.AiToolId).OnDelete(DeleteBehavior.NoAction);
            e.HasIndex(x => new { x.UserId, x.WorkDate }).IsUnique().HasDatabaseName("UQ_DailyAiUsage_User_WorkDate");
        });

        b.Entity<AuditLog>(e =>
        {
            // Append-only, protected by an INSTEAD OF trigger -> declare it (see DsrEntry note).
            e.ToTable("AuditLog", tb => tb.HasTrigger("trg_AuditLog_PreventChange"));
            e.Property(x => x.EntityName).HasMaxLength(100).IsRequired();
            e.Property(x => x.ActionType).HasMaxLength(20).IsRequired();
            e.Property(x => x.IpAddress).HasMaxLength(45);
            e.HasOne(x => x.ChangedByUser).WithMany().HasForeignKey(x => x.ChangedByUserId).OnDelete(DeleteBehavior.NoAction);
        });

        /* ------------------------- Read model: views and TVFs ----------------------------- */
        b.Entity<DsrEntryDetailView>().HasNoKey().ToView("vw_DsrEntryDetail", Schema);
        b.Entity<DsrDailySummaryView>().HasNoKey().ToView("vw_DsrDailySummary", Schema);
        b.Entity<DsrMonthlySummaryView>().HasNoKey().ToView("vw_DsrMonthlySummary", Schema);
        b.Entity<ProjectEffortSummaryView>().HasNoKey().ToView("vw_ProjectEffortSummary", Schema);
        b.Entity<AiAdoptionDailyView>().HasNoKey().ToView("vw_AiAdoptionDaily", Schema);
        b.Entity<DsrDetailReportView>().HasNoKey().ToView("vw_DsrDetailReport", Schema);

        // TVFs are queried with FromSqlInterpolated in ReportingRepository; mapped keyless with no
        // backing table so EF never attempts to generate DDL or a plain SELECT for them.
        b.Entity<ResourceUtilizationView>().HasNoKey().ToView(null);
        b.Entity<MissingDsrDetailView>().HasNoKey().ToView(null);

        foreach (var view in new[]
                 {
                     typeof(DsrEntryDetailView), typeof(DsrDailySummaryView), typeof(DsrMonthlySummaryView),
                     typeof(ProjectEffortSummaryView), typeof(AiAdoptionDailyView),
                     typeof(ResourceUtilizationView),
                     typeof(DsrDetailReportView), typeof(MissingDsrDetailView)
                 })
        {
            foreach (var prop in b.Model.FindEntityType(view)!.GetProperties()
                         .Where(p => p.ClrType == typeof(decimal) || p.ClrType == typeof(decimal?)))
            {
                prop.SetColumnType("decimal(18,4)");
            }
        }

        /* ------------------------------- Soft delete -------------------------------------- */
        // Applied as global filters so no query can accidentally return deactivated rows. Tables
        // whose rows are administered (users, projects, roles, settings) are excluded, because the
        // admin screens must be able to see and reactivate an inactive record.
        b.Entity<DsrEntry>().HasQueryFilter(x => x.IsActive);
        b.Entity<DailyAiUsage>().HasQueryFilter(x => x.IsActive);
        b.Entity<ProjectAllocation>().HasQueryFilter(x => x.IsActive);
        b.Entity<UserRole>().HasQueryFilter(x => x.IsActive);
        b.Entity<Holiday>().HasQueryFilter(x => x.IsActive);

        base.OnModelCreating(b);
    }

    /// <summary>
    /// Stamps the five audit columns on every insert and update. Callers never set them, so a
    /// forgotten assignment cannot produce an unattributed row. The bootstrap SYSTEM user (id 1)
    /// is used when no principal is present, which covers background jobs and seeding.
    /// </summary>
    public override Task<int> SaveChangesAsync(CancellationToken ct = default)
    {
        var actorId = currentUser.UserId ?? 1;
        var now = clock.UtcNow;

        foreach (var entry in ChangeTracker.Entries<AuditableEntity>())
        {
            switch (entry.State)
            {
                case EntityState.Added:
                    entry.Entity.CreatedByUserId = actorId;
                    entry.Entity.CreatedDate = now;
                    entry.Entity.ModifiedByUserId = null;
                    entry.Entity.ModifiedDate = null;
                    break;

                case EntityState.Modified:
                    entry.Entity.ModifiedByUserId = actorId;
                    entry.Entity.ModifiedDate = now;
                    // CreatedBy/CreatedDate are immutable once set.
                    entry.Property(nameof(AuditableEntity.CreatedByUserId)).IsModified = false;
                    entry.Property(nameof(AuditableEntity.CreatedDate)).IsModified = false;
                    break;
            }
        }

        foreach (var entry in ChangeTracker.Entries<AuditLog>().Where(e => e.State == EntityState.Added))
        {
            entry.Entity.CreatedByUserId = actorId;
            entry.Entity.CreatedDate = now;
            if (entry.Entity.ChangedDate == default) entry.Entity.ChangedDate = now;
            if (entry.Entity.ChangedByUserId == 0) entry.Entity.ChangedByUserId = actorId;
        }

        return base.SaveChangesAsync(ct);
    }
}
