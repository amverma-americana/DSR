using System.Net;

namespace DSR.Application.Common;

/// <summary>Uniform envelope for every API response, so the React client has one shape to parse.</summary>
public class ApiResponse<T>
{
    public bool Succeeded { get; init; }
    public T? Data { get; init; }
    public string? Message { get; init; }
    public IReadOnlyDictionary<string, string[]>? Errors { get; init; }
    public string? TraceId { get; init; }

    public static ApiResponse<T> Ok(T data, string? message = null) =>
        new() { Succeeded = true, Data = data, Message = message };

    public static ApiResponse<T> Fail(string message, IReadOnlyDictionary<string, string[]>? errors = null, string? traceId = null) =>
        new() { Succeeded = false, Message = message, Errors = errors, TraceId = traceId };
}

/// <summary>Server-side paging result. Every list endpoint returns this; nothing is fetched unbounded.</summary>
public class PagedResult<T>
{
    public IReadOnlyList<T> Items { get; init; } = [];
    public int TotalCount { get; init; }
    public int Page { get; init; }
    public int PageSize { get; init; }
    public int TotalPages => PageSize <= 0 ? 0 : (int)Math.Ceiling(TotalCount / (double)PageSize);
    public bool HasPrevious => Page > 1;
    public bool HasNext => Page < TotalPages;

    public static PagedResult<T> Create(IReadOnlyList<T> items, int totalCount, int page, int pageSize) =>
        new() { Items = items, TotalCount = totalCount, Page = page, PageSize = pageSize };
}

/// <summary>Base paging/sorting request. Page size is clamped so a client cannot request the whole table.</summary>
public abstract class PagedRequest
{
    private const int MaxPageSize = 200;
    private int _pageSize = 25;
    private int _page = 1;

    public int Page
    {
        get => _page;
        set => _page = value < 1 ? 1 : value;
    }

    public int PageSize
    {
        get => _pageSize;
        set => _pageSize = value switch { < 1 => 25, > MaxPageSize => MaxPageSize, _ => value };
    }

    public string? SortBy { get; set; }
    public bool SortDescending { get; set; }
}

/*  Exception hierarchy. The global exception middleware maps each to an HTTP status code, so no
    controller ever writes a status code for an error path.                                      */

public abstract class AppException(string message, HttpStatusCode statusCode) : Exception(message)
{
    public HttpStatusCode StatusCode { get; } = statusCode;
}

/// <summary>400 -- request failed business or field validation.</summary>
public class ValidationAppException : AppException
{
    public IReadOnlyDictionary<string, string[]> Errors { get; }

    public ValidationAppException(IReadOnlyDictionary<string, string[]> errors)
        : base("One or more validation errors occurred.", HttpStatusCode.BadRequest) => Errors = errors;

    public ValidationAppException(string field, string error)
        : base("One or more validation errors occurred.", HttpStatusCode.BadRequest) =>
        Errors = new Dictionary<string, string[]> { [field] = [error] };
}

/// <summary>404 -- entity does not exist, or is outside the caller's data scope.</summary>
public class NotFoundException(string entity, object key)
    : AppException($"{entity} with identifier '{key}' was not found.", HttpStatusCode.NotFound);

/// <summary>403 -- authenticated but not permitted (e.g. employee reading another employee's DSR).</summary>
public class ForbiddenException(string message = "You are not permitted to perform this action.")
    : AppException(message, HttpStatusCode.Forbidden);

/// <summary>401 -- authentication failed or the token is no longer valid.</summary>
public class UnauthorizedAppException(string message = "Authentication failed.")
    : AppException(message, HttpStatusCode.Unauthorized);

/// <summary>409 -- the request conflicts with current state (duplicate key, concurrent edit).</summary>
public class ConflictException(string message) : AppException(message, HttpStatusCode.Conflict);

/// <summary>422 -- syntactically valid but violates a business rule (e.g. daily hour cap).</summary>
public class BusinessRuleException(string message)
    : AppException(message, HttpStatusCode.UnprocessableEntity);
