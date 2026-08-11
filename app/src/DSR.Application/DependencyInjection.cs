using System.Text.RegularExpressions;
using AutoMapper;
using DSR.Application.Common;
using DSR.Application.DTOs;
using DSR.Application.Interfaces;
using DSR.Application.Services;
using DSR.Domain.Common;
using DSR.Domain.Entities;
using FluentValidation;
using Ganss.Xss;
using Microsoft.Extensions.DependencyInjection;

namespace DSR.Application;

public static class DependencyInjection
{
    public static IServiceCollection AddApplicationLayer(this IServiceCollection services)
    {
        // AutoMapper 15 changed AddAutoMapper to take a configuration action rather than an
        // assembly list; AddMaps scans this assembly for Profile classes (see MappingProfile below).
        services.AddAutoMapper(cfg => cfg.AddMaps(typeof(DependencyInjection).Assembly));
        services.AddValidatorsFromAssembly(typeof(DependencyInjection).Assembly, includeInternalTypes: true);

        services.AddScoped<IDsrEntryService, DsrEntryService>();
        services.AddScoped<IUserService, UserService>();
        services.AddScoped<IProjectService, ProjectService>();
        services.AddScoped<IMasterDataService, MasterDataService>();
        services.AddScoped<IReportingService, ReportingService>();
        services.AddScoped<IDetailReportService, DetailReportService>();
        services.AddSingleton<IHtmlContentService, HtmlContentService>();

        return services;
    }
}

/// <summary>
/// AutoMapper configuration. Kept intentionally small: the read paths use explicit LINQ
/// projections (Select) so EF translates them to SQL and fetches only the needed columns.
/// AutoMapper is used for entity to DTO conversion of already-materialised objects only.
/// </summary>
public class MappingProfile : Profile
{
    public MappingProfile()
    {
        CreateMap<User, UserDto>()
            .ForMember(d => d.ManagerName, o => o.MapFrom(s => s.Manager != null ? s.Manager.FullName : null))
            .ForMember(d => d.HasDatabaseCredential, o => o.MapFrom(s => s.Credential != null))
            .ForMember(d => d.Roles, o => o.MapFrom(s => s.UserRoles.Where(r => r.IsActive).Select(r => r.Role.RoleCode)));

        CreateMap<User, AuthenticatedUserDto>()
            .ForMember(d => d.Roles, o => o.MapFrom(s => s.UserRoles.Where(r => r.IsActive).Select(r => r.Role.RoleCode)))
            .ForMember(d => d.HasDirectReports, o => o.Ignore());

        CreateMap<Project, ProjectDto>()
            .ForMember(d => d.ProjectManagerName, o => o.MapFrom(s => s.ProjectManager != null ? s.ProjectManager.FullName : null))
            .ForMember(d => d.AllocatedResourceCount, o => o.MapFrom(s => s.Allocations.Count(a => a.IsActive)))
            .ForMember(d => d.IsOpenForEffort, o => o.Ignore());

        CreateMap<DsrEntry, DsrEntryDto>()
            .ForMember(d => d.EmployeeName, o => o.MapFrom(s => s.User.FullName))
            .ForMember(d => d.EmployeeCode, o => o.MapFrom(s => s.User.EmployeeCode))
            .ForMember(d => d.ProjectCode, o => o.MapFrom(s => s.Project != null ? s.Project.ProjectCode : null))
            .ForMember(d => d.ProjectName, o => o.MapFrom(s => s.Project != null ? s.Project.ProjectName : null))
            .ForMember(d => d.IsAiUsed, o => o.Ignore())
            .ForMember(d => d.AiToolId, o => o.Ignore())
            .ForMember(d => d.AiToolName, o => o.Ignore())
            .ForMember(d => d.AiUsageRemarks, o => o.Ignore())
            .ForMember(d => d.IsEditable, o => o.Ignore());

        CreateMap<ProjectAllocation, ProjectAllocationDto>()
            .ForMember(d => d.ProjectCode, o => o.MapFrom(s => s.Project.ProjectCode))
            .ForMember(d => d.ProjectName, o => o.MapFrom(s => s.Project.ProjectName))
            .ForMember(d => d.EmployeeName, o => o.MapFrom(s => s.User.FullName));

        CreateMap<AppSetting, AppSettingDto>();
    }
}

/// <summary>
/// Sanitises rich-text descriptions. Stored XSS is the highest-severity risk on this application
/// because descriptions are rendered on manager and admin dashboards -- so sanitisation happens on
/// WRITE, not on render: one sanitised copy in the database beats trusting every future view.
/// </summary>
public class HtmlContentService : IHtmlContentService
{
    private readonly HtmlSanitizer _sanitizer;

    public HtmlContentService()
    {
        _sanitizer = new HtmlSanitizer();
        _sanitizer.AllowedTags.Clear();
        // "div" is allowed because rich-text editors wrap content in it; with KeepChildNodes = false
        // an unlisted container would take its own text content with it.
        foreach (var tag in new[] { "p", "div", "br", "strong", "b", "em", "i", "u", "ul", "ol", "li", "span", "h3", "h4", "blockquote", "code", "pre", "a" })
            _sanitizer.AllowedTags.Add(tag);

        _sanitizer.AllowedAttributes.Clear();
        _sanitizer.AllowedAttributes.Add("href");
        _sanitizer.AllowedAttributes.Add("title");

        _sanitizer.AllowedSchemes.Clear();
        _sanitizer.AllowedSchemes.Add("https");
        _sanitizer.AllowedSchemes.Add("mailto");

        _sanitizer.AllowedCssProperties.Clear();

        /*  MUST be false. With KeepChildNodes = true the sanitiser strips a disallowed tag but keeps
            its text content, so "<script>alert(1)</script>" survives as the literal text "alert(1)".
            That is harmless as text but it means script payloads are silently unwrapped rather than
            removed, and any future change that renders descriptions as raw HTML would reintroduce
            the injection. Dropping the subtree is the safe behaviour.                             */
        _sanitizer.KeepChildNodes = false;
    }

    public string Sanitize(string? html) => string.IsNullOrWhiteSpace(html) ? string.Empty : _sanitizer.Sanitize(html);

    public string ToPlainText(string? html)
    {
        if (string.IsNullOrWhiteSpace(html)) return string.Empty;

        var text = Regex.Replace(html, "<(br|/p|/li|/div)[^>]*>", " ", RegexOptions.IgnoreCase);
        text = Regex.Replace(text, "<[^>]+>", string.Empty);
        text = System.Net.WebUtility.HtmlDecode(text);
        return Regex.Replace(text, @"\s+", " ").Trim();
    }
}

/* ------------------------------------- VALIDATORS -------------------------------------
   Field-shape validation only. Cross-entity and cross-row business rules live in the services
   (and are guaranteed by the database), because a validator cannot query state safely.        */

public class CreateDsrEntryRequestValidator : AbstractValidator<CreateDsrEntryRequest>
{
    public CreateDsrEntryRequestValidator()
    {
        RuleFor(x => x.WorkDate)
            .NotEmpty().WithMessage("Work date is required.");

        RuleFor(x => x.EstimatedHours)
            .InclusiveBetween(0m, 24m).WithMessage("Hours must be between 0 and 24.");

        RuleFor(x => x.IsAiUsed)
            .NotNull().WithMessage("Please state whether AI was used today.");

        RuleFor(x => x.ProjectId)
            .NotNull().When(x => !x.IsNoWorkDone).WithMessage("Project is required for a work entry.")
            .Null().When(x => x.IsNoWorkDone).WithMessage("A project cannot be selected when no work was done.");

        RuleFor(x => x.EstimatedHours)
            .Equal(0m).When(x => x.IsNoWorkDone).WithMessage("Hours must be zero when 'No Work Done' is selected.")
            .GreaterThan(0m).When(x => !x.IsNoWorkDone).WithMessage("Hours must be greater than zero for a work entry.");

        RuleFor(x => x.AiToolId)
            .NotNull().When(x => x.IsAiUsed == true).WithMessage("Select the AI tool you used.")
            .Null().When(x => x.IsAiUsed == false).WithMessage("An AI tool cannot be selected when AI was not used.");

        RuleFor(x => x.AiUsageRemarks).MaximumLength(1000);
        RuleFor(x => x.WorkDescriptionHtml).MaximumLength(20000);
    }
}

public class UpdateDsrEntryRequestValidator : AbstractValidator<UpdateDsrEntryRequest>
{
    public UpdateDsrEntryRequestValidator()
    {
        RuleFor(x => x.EstimatedHours).InclusiveBetween(0m, 24m).WithMessage("Hours must be between 0 and 24.");
        RuleFor(x => x.IsAiUsed).NotNull().WithMessage("Please state whether AI was used today.");
        RuleFor(x => x.ProjectId).NotNull().When(x => !x.IsNoWorkDone).WithMessage("Project is required for a work entry.");
        RuleFor(x => x.EstimatedHours).Equal(0m).When(x => x.IsNoWorkDone).WithMessage("Hours must be zero when 'No Work Done' is selected.");
        RuleFor(x => x.AiToolId).NotNull().When(x => x.IsAiUsed == true).WithMessage("Select the AI tool you used.");
        RuleFor(x => x.AiUsageRemarks).MaximumLength(1000);
    }
}

public class DatabaseLoginRequestValidator : AbstractValidator<DatabaseLoginRequest>
{
    public DatabaseLoginRequestValidator()
    {
        RuleFor(x => x.Email).NotEmpty().EmailAddress().MaximumLength(256);
        RuleFor(x => x.Password).NotEmpty().MaximumLength(256);
    }
}

public class ChangePasswordRequestValidator : AbstractValidator<ChangePasswordRequest>
{
    public ChangePasswordRequestValidator()
    {
        RuleFor(x => x.CurrentPassword).NotEmpty();
        RuleFor(x => x.NewPassword)
            .NotEmpty()
            .MinimumLength(12).WithMessage("Password must be at least 12 characters.")
            .Matches("[A-Z]").WithMessage("Password must contain an upper-case letter.")
            .Matches("[a-z]").WithMessage("Password must contain a lower-case letter.")
            .Matches("[0-9]").WithMessage("Password must contain a digit.")
            .Matches("[^a-zA-Z0-9]").WithMessage("Password must contain a special character.")
            .NotEqual(x => x.CurrentPassword).WithMessage("The new password must differ from the current password.");
    }
}

public class CreateUserRequestValidator : AbstractValidator<CreateUserRequest>
{
    public CreateUserRequestValidator()
    {
        RuleFor(x => x.FirstName).NotEmpty().MaximumLength(100);
        RuleFor(x => x.LastName).NotEmpty().MaximumLength(100);
        RuleFor(x => x.Email).NotEmpty().EmailAddress().MaximumLength(256);
        RuleFor(x => x.EmployeeCode).MaximumLength(30);
        RuleFor(x => x.Designation).MaximumLength(100);
        RuleFor(x => x.StandardDailyHours).InclusiveBetween(0.5m, 24m);
        RuleFor(x => x.AuthenticationType)
            .Must(v => v is AuthenticationTypes.Sso or AuthenticationTypes.Database or AuthenticationTypes.Both)
            .WithMessage("Authentication type must be SSO, DATABASE or BOTH.");
        RuleFor(x => x.ExternalObjectId)
            .NotEmpty().When(x => AuthenticationTypes.AllowsSso(x.AuthenticationType))
            .WithMessage("An Entra ID object id is required for SSO-enabled accounts.");
    }
}

public class UpdateUserRequestValidator : AbstractValidator<UpdateUserRequest>
{
    public UpdateUserRequestValidator()
    {
        RuleFor(x => x.FirstName).NotEmpty().MaximumLength(100);
        RuleFor(x => x.LastName).NotEmpty().MaximumLength(100);
        RuleFor(x => x.Email).NotEmpty().EmailAddress().MaximumLength(256);
        RuleFor(x => x.StandardDailyHours).InclusiveBetween(0.5m, 24m);
        RuleFor(x => x.DateOfExit)
            .GreaterThanOrEqualTo(x => x.DateOfJoining!.Value)
            .When(x => x.DateOfExit.HasValue && x.DateOfJoining.HasValue)
            .WithMessage("Exit date cannot be earlier than the joining date.");
    }
}

public class CreateProjectRequestValidator : AbstractValidator<CreateProjectRequest>
{
    public CreateProjectRequestValidator()
    {
        RuleFor(x => x.ProjectCode).NotEmpty().MaximumLength(30)
            .Matches("^[A-Za-z0-9._-]+$").WithMessage("Project code may contain only letters, digits, dot, underscore and hyphen.");
        RuleFor(x => x.ProjectName).NotEmpty().MaximumLength(200);
        RuleFor(x => x.Description).MaximumLength(1000);
        RuleFor(x => x.StartDate).NotEmpty();
        RuleFor(x => x.EndDate).GreaterThanOrEqualTo(x => x.StartDate).When(x => x.EndDate.HasValue)
            .WithMessage("End date cannot be earlier than start date.");
        RuleFor(x => x.Status).Must(s => ProjectStatuses.All.Contains(s))
            .WithMessage($"Status must be one of: {string.Join(", ", ProjectStatuses.All)}.");
    }
}

public class SaveProjectAllocationRequestValidator : AbstractValidator<SaveProjectAllocationRequest>
{
    public SaveProjectAllocationRequestValidator()
    {
        RuleFor(x => x.ProjectId).GreaterThan(0);
        RuleFor(x => x.UserId).GreaterThan(0);
        RuleFor(x => x.AllocationPercentage).InclusiveBetween(0.01m, 100m);
        RuleFor(x => x.AllocationStartDate).NotEmpty();
        RuleFor(x => x.AllocationEndDate).GreaterThanOrEqualTo(x => x.AllocationStartDate)
            .When(x => x.AllocationEndDate.HasValue);
        RuleFor(x => x.ProjectRole).MaximumLength(100);
    }
}
