//! Tetik Aim web server: serves `web/` and a small leaderboard API.
//!
//! Environment:
//! - `TETIK_ADDR`  listen address (default `0.0.0.0:8080`)
//! - `TETIK_WEB`   directory with the game files (default `web`)
//! - `TETIK_DATA`  leaderboard file (default `data/scores.json`)

use axum::{
    extract::{ConnectInfo, Query, State},
    http::{header, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use serde::Deserialize;
use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tetik_core::{Store, Submission, MODES};
use tokio::sync::Mutex;
use tower_http::{services::ServeDir, set_header::SetResponseHeaderLayer};

/// Minimum time between two submissions from one IP.
const SUBMIT_INTERVAL: Duration = Duration::from_secs(5);

struct App {
    store: Mutex<Store>,
    last_submit: Mutex<HashMap<IpAddr, Instant>>,
}

type Shared = Arc<App>;

#[tokio::main]
async fn main() {
    let addr = env_or("TETIK_ADDR", "0.0.0.0:8080");
    let web = env_or("TETIK_WEB", "web");
    let data = env_or("TETIK_DATA", "data/scores.json");

    let store = Store::open(&data).unwrap_or_else(|e| {
        eprintln!("cannot open {data}: {e}");
        std::process::exit(1);
    });
    let app = Arc::new(App {
        store: Mutex::new(store),
        last_submit: Mutex::new(HashMap::new()),
    });

    let api = Router::new()
        .route("/api/health", get(|| async { "ok" }))
        .route("/api/modes", get(|| async { Json(MODES) }))
        .route("/api/leaderboard", get(leaderboard))
        .route("/api/scores", axum::routing::post(submit))
        .layer(SetResponseHeaderLayer::overriding(
            header::CACHE_CONTROL,
            HeaderValue::from_static("no-store"),
        ))
        .with_state(app);

    let router = api.fallback_service(ServeDir::new(&web));
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .unwrap_or_else(|e| {
            eprintln!("cannot listen on {addr}: {e}");
            std::process::exit(1);
        });
    println!("Tetik Aim: http://{}", listener.local_addr().unwrap());
    axum::serve(
        listener,
        router.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(async {
        let _ = tokio::signal::ctrl_c().await;
    })
    .await
    .unwrap();
}

fn env_or(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}

#[derive(Deserialize)]
struct LbQuery {
    mode: String,
    #[serde(default = "default_limit")]
    limit: usize,
}

fn default_limit() -> usize {
    20
}

async fn leaderboard(State(app): State<Shared>, Query(q): Query<LbQuery>) -> Response {
    if tetik_core::mode(&q.mode).is_none() {
        return error(StatusCode::NOT_FOUND, "Bilinmeyen mod");
    }
    let store = app.store.lock().await;
    Json(store.board().top(&q.mode, q.limit.min(100))).into_response()
}

async fn submit(
    State(app): State<Shared>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    Json(sub): Json<Submission>,
) -> Response {
    // shortcut: rate limit by socket address; behind a reverse proxy this is
    // the proxy's address, read X-Forwarded-For from a trusted proxy instead.
    {
        let mut last = app.last_submit.lock().await;
        let now = Instant::now();
        last.retain(|_, t| now.duration_since(*t) < SUBMIT_INTERVAL);
        if last.contains_key(&peer.ip()) {
            return error(StatusCode::TOO_MANY_REQUESTS, "Çok hızlı, biraz bekle");
        }
        last.insert(peer.ip(), now);
    }
    let mut store = app.store.lock().await;
    match store.submit(&sub) {
        Ok(res) => Json(res).into_response(),
        Err(e) if e.is::<tetik_core::Invalid>() => {
            error(StatusCode::UNPROCESSABLE_ENTITY, &e.to_string())
        }
        Err(e) => {
            eprintln!("save failed: {e}");
            error(StatusCode::INTERNAL_SERVER_ERROR, "Kayıt başarısız")
        }
    }
}

fn error(code: StatusCode, msg: &str) -> Response {
    (code, Json(serde_json::json!({ "error": msg }))).into_response()
}
