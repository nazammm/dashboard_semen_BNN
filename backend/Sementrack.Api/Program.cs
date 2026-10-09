using Npgsql;
using Sementrack.Api.Data;
using Sementrack.Api.Endpoints;
using Sementrack.Api.Security;
using Sementrack.Core;

var builder = WebApplication.CreateBuilder(args);

var cs = new NpgsqlConnectionStringBuilder
{
    Host = builder.Configuration["DB_HOST"] ?? "10.10.20.8",
    Port = builder.Configuration.GetValue("DB_PORT", 61385),
    Database = builder.Configuration["DB_NAME"] ?? "web_semen",
    Username = builder.Configuration["DB_USER"],
    Password = builder.Configuration["DB_PASSWORD"],
    MaxPoolSize = builder.Configuration.GetValue("DB_POOL_MAX", 10),
}.ConnectionString;

builder.Services.AddSingleton(NpgsqlDataSource.Create(cs));
builder.Services.AddSingleton<Db>();
builder.Services.AddSingleton<AuthService>();
builder.Services.AddSingleton<LoginThrottle>();
builder.Services.AddHsts(o => o.MaxAge = TimeSpan.FromDays(365));

var origin = builder.Configuration["ALLOWED_ORIGIN"];
if (!string.IsNullOrWhiteSpace(origin))
    builder.Services.AddCors(o => o.AddDefaultPolicy(p => p.WithOrigins(origin).AllowAnyHeader().AllowAnyMethod().WithExposedHeaders("Content-Range")));

var app = builder.Build();

// Sub-folder (mis. https://bangunsukses.com/Dashboard_semen/) tanpa IIS virtual-app: set PATH_BASE=/Dashboard_semen
// (di IIS virtual application, IIS sudah mengatur path base sendiri -- jangan set).
if (!string.IsNullOrWhiteSpace(app.Configuration["PATH_BASE"])) app.UsePathBase(app.Configuration["PATH_BASE"]);

if (!app.Environment.IsDevelopment()) { app.UseHsts(); app.UseHttpsRedirection(); }

// Header keamanan (setara CSP di versi lama). Tile peta: Esri/CARTO.
app.Use(async (ctx, next) =>
{
    var h = ctx.Response.Headers;
    h["X-Content-Type-Options"] = "nosniff";
    h["Referrer-Policy"] = "same-origin";
    h["X-Frame-Options"] = "DENY";
    if (!ctx.Request.Path.StartsWithSegments("/api"))
        h["Content-Security-Policy"] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://*.basemaps.cartocdn.com https://server.arcgisonline.com; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";
    else h["Cache-Control"] = "no-store";
    await next();
});
if (!string.IsNullOrWhiteSpace(origin)) app.UseCors();

await SchemaBootstrap.RunAsync(app.Services.GetRequiredService<Db>(), app.Configuration, app.Logger);

var api = app.MapGroup("/api");
api.MapGet("/", () => Results.Json(new { ok = true, message = "SEMENTRACK API jalan.", version = "v11-aspnet" }));
LoginEndpoint.Map(api);
AdminEndpoints.Map(api);
DataEndpoints.Map(api); // berisi GET /{table}: harus didaftarkan setelah route statis

// Frontend (hasil build React) disajikan dari wwwroot; SPA fallback ke index.html.
app.UseDefaultFiles();
app.UseStaticFiles();
app.MapFallbackToFile("index.html");

app.Run();
