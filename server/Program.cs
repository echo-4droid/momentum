using Momentum.Api;
using Momentum.Constants;
using Momentum.Installers;

var builder = WebApplication.CreateSlimBuilder(args);

builder
    .AddMomentumOptions()
    .AddMomentumWebServer()
    .AddVault()
    .AddMomentumRateLimiter();

var app = builder.Build();

// Конвейер обработки запроса
app.UseForwardedHeaders();
app.UseMomentumExceptionHandler();
app.UseRateLimiter();

// Статика веб-клиента
app.UseDefaultFiles();
app.UseStaticFiles();

// API
app.MapPost("/api/v1/secrets", VaultEndpoints.Create).RequireRateLimiting(RateLimiterPolicies.Slow);
app.MapGet("/api/v1/secrets/{id}", VaultEndpoints.Read).RequireRateLimiting(RateLimiterPolicies.Normal);
app.MapGet("/api/v1/secrets/{id}/status", VaultEndpoints.Status).RequireRateLimiting(RateLimiterPolicies.Normal);
app.MapFallbackToFile("/s/{*path}", "index.html");

app.Run();
